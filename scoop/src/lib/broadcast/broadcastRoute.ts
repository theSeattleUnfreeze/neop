/**
 * Preview and send for the two-wave broadcast.
 * Responses name files and chains. They do not include raw transactions, txids, or addresses.
 */

import { Transaction } from "bitcoinjs-lib";
import { catalogNeeds } from "@/lib/broadcast/catalogNeed";
import { inspectBase64, type InspectedPsbt } from "@/lib/broadcast/inspectPsbt";
import { nodeRpc, scrubRpcText } from "@/lib/broadcast/nodeRpc";
import {
  assemblePreview,
  coreInputsSpent,
  filesForPhase,
  maySendWave1,
  nextWave,
  rdtsWarning,
  sendStoppedReason,
  type Flavor,
  type PreviewRow,
} from "@/lib/broadcast/pairWave";
import {
  chainTipReady,
  mayBroadcast,
  outputGone,
  phaseProblems,
  readMempoolAccept,
  readTxOut,
  sameNetwork,
  type MempoolVerdict,
} from "@/lib/broadcast/wave";
import { rowStatus, type RowStatus } from "@/lib/broadcast/watch";

export type DroppedFile = { name: string; base64: string };

const MAX_FILES = 200;

export function readDroppedFiles(body: unknown): DroppedFile[] | { error: string } {
  if (!body || typeof body !== "object") return { error: "Missing files." };
  const files = (body as { files?: unknown }).files;
  if (!Array.isArray(files) || files.length === 0) return { error: "Drop the signed files first." };
  if (files.length > MAX_FILES) return { error: "Too many files." };
  const out: DroppedFile[] = [];
  for (const row of files) {
    if (!row || typeof row !== "object") return { error: "A file was missing." };
    const name = typeof (row as { name?: unknown }).name === "string" ? (row as { name: string }).name : "";
    const base64 = typeof (row as { base64?: unknown }).base64 === "string" ? (row as { base64: string }).base64 : "";
    const leaf = name.split(/[/\\]/).pop()?.trim() ?? "";
    if (!leaf || leaf.length > 180 || !base64) return { error: "A file was missing." };
    out.push({ name: leaf, base64 });
  }
  return out;
}

function checkedNames(body: unknown): string[] {
  const checked = (body as { checked?: unknown }).checked;
  if (!Array.isArray(checked)) return [];
  return checked.filter((name): name is string => typeof name === "string");
}

function phaseOf(body: unknown): Flavor | null {
  const phase = (body as { phase?: unknown }).phase;
  return phase === "core" || phase === "knots" ? phase : null;
}

async function rdts(): Promise<{ warn: boolean; reasons: string[] }> {
  let median: number | null = null;
  try {
    const info = await nodeRpc("knots", "getblockchaininfo");
    if (info && typeof info === "object" && typeof (info as { mediantime?: unknown }).mediantime === "number") {
      median = (info as { mediantime: number }).mediantime;
    }
  } catch {
    median = null;
  }
  return rdtsWarning(Date.now(), median);
}

function inspectedRows(files: DroppedFile[]): InspectedPsbt[] | { error: string } {
  try {
    return files.map((file) => inspectBase64(file.name, file.base64));
  } catch {
    return { error: "One of the files is not a PSBT." };
  }
}

export async function previewDrop(files: DroppedFile[]): Promise<
  | { rows: PreviewRow[]; problems: string[]; pairOk: boolean; rdts: { warn: boolean; reasons: string[] } }
  | { error: string }
> {
  const inspected = inspectedRows(files);
  if ("error" in inspected) return inspected;
  const points = inspected.flatMap((file) => file.outpoints);
  let catalog: Awaited<ReturnType<typeof catalogNeeds>>;
  try {
    catalog = await catalogNeeds(points);
  } catch {
    return { error: "Scoop could not read the catalog." };
  }
  const view = assemblePreview(
    inspected.map((file) => ({
      name: file.name,
      guess: file.guess,
      inputCount: file.inputCount,
      outpoints: file.outpoints,
    })),
    catalog
  );
  return {
    rows: view.rows,
    problems: view.problems.map((problem) => problem.message),
    pairOk: view.pairOk,
    rdts: await rdts(),
  };
}

async function tipReady(target: Flavor): Promise<boolean> {
  const info = await nodeRpc(target, "getblockchaininfo");
  return chainTipReady(info);
}

async function sharedGenesis(): Promise<boolean> {
  const core = await nodeRpc("core", "getblockhash", [0]);
  const knots = await nodeRpc("knots", "getblockhash", [0]);
  return sameNetwork(core, knots);
}

export async function sendDrop(body: unknown): Promise<
  { phase: Flavor; sent: number; stopped?: string } | { error: string; status: number }
> {
  const files = readDroppedFiles(body);
  if ("error" in files) return { error: files.error, status: 400 };
  const phase = phaseOf(body);
  if (!phase) return { error: "Say whether this is the Core wave or the Knots wave.", status: 400 };
  const preview = await previewDrop(files);
  if ("error" in preview) return { error: preview.error, status: 503 };
  const checked = new Set(checkedNames(body));
  const gate = maySendWave1({
    fileCount: preview.rows.length,
    checkedCount: preview.rows.filter((row) => checked.has(row.name)).length,
    pairOk: preview.pairOk,
  });
  if (!gate.ok) return { error: gate.reason, status: 400 };

  const inspected = inspectedRows(files);
  if ("error" in inspected) return { error: inspected.error, status: 400 };
  const points = inspected.flatMap((file) => file.outpoints);
  const catalog = await catalogNeeds(points);
  const assembled = assemblePreview(
    inspected.map((file) => ({
      name: file.name,
      guess: file.guess,
      inputCount: file.inputCount,
      outpoints: file.outpoints,
    })),
    catalog
  );
  const picked = filesForPhase(
    assembled.rows.map((row, index) => ({ ...row, hex: inspected[index]?.hex ?? null })),
    phase
  );
  if (!picked.ok) return { error: picked.reason, status: 400 };

  if (phase === "knots") {
    const coreCount = assembled.rows.filter((row) => row.flavor === "core").length;
    const spent = await coreSpentFlags(inspected, assembled.rows);
    if ("error" in spent) return { error: spent.error, status: 503 };
    const step = nextWave({ coreFileCount: coreCount, coreInputsSpent: coreInputsSpent(spent), knotsSent: false });
    if (step.phase !== "send-knots") return { error: step.reason, status: 409 };
  }

  const local: string[] = [];
  const hexes: string[] = [];
  for (const row of picked.files) {
    if (!row.hex || !row.flavor) {
      local.push(`${row.name} is not signed.`);
      continue;
    }
    const tx = Transaction.fromHex(row.hex);
    const problems = phaseProblems(tx, row.flavor, row.whyKey);
    if (problems.length) local.push(problems[0]);
    else hexes.push(row.hex);
  }

  let verdicts: MempoolVerdict[] = [];
  if (local.length === 0) {
    try {
      const result = await nodeRpc(phase, "testmempoolaccept", [hexes]);
      const rows = Array.isArray(result) ? result : [result];
      verdicts = rows.map((row) => readMempoolAccept(row));
    } catch (err) {
      return { error: scrubRpcText(err instanceof Error ? err.message : "Preflight failed."), status: 503 };
    }
  }
  const allowed = mayBroadcast(local, verdicts);
  if (!allowed.ok) return { error: `${allowed.reason} Nothing sent.`, status: 400 };

  let sent = 0;
  for (const hex of hexes) {
    try {
      await nodeRpc(phase, "sendrawtransaction", [hex, 0]);
      sent += 1;
    } catch (err) {
      const detail = scrubRpcText(err instanceof Error ? err.message : "Send failed.");
      return {
        phase,
        sent,
        stopped: `${sendStoppedReason(phase, sent)} ${detail}`,
      };
    }
  }
  return { phase, sent };
}

async function coreSpentFlags(
  inspected: InspectedPsbt[],
  rows: PreviewRow[]
): Promise<(boolean | null)[] | { error: string }> {
  const corePoints = inspected.flatMap((file, index) => (rows[index]?.flavor === "core" ? file.outpoints : []));
  if (corePoints.length === 0) return [];
  try {
    if (!(await tipReady("core"))) return corePoints.map(() => null);
    if (!(await sharedGenesis())) return { error: "Core and Knots are not the same network." };
    const flags: (boolean | null)[] = [];
    for (const point of corePoints) {
      const [txid, voutRaw] = point.split(":");
      const vout = Number(voutRaw);
      const view = readTxOut(await nodeRpc("core", "gettxout", [txid, vout, false]));
      flags.push(outputGone(true, view));
    }
    return flags;
  } catch (err) {
    return { error: scrubRpcText(err instanceof Error ? err.message : "Core did not answer.") };
  }
}

export async function watchDrop(body: unknown): Promise<
  | {
      phase: string;
      reason: string;
      rows: { name: string; status: RowStatus }[];
      rdts: { warn: boolean; reasons: string[] };
    }
  | { error: string }
> {
  if (!body || typeof body !== "object") return { error: "Missing watch request." };
  const points = Array.isArray((body as { points?: unknown }).points) ? (body as { points: unknown[] }).points : [];
  const named = Array.isArray((body as { rows?: unknown }).rows) ? (body as { rows: unknown[] }).rows : [];
  const corePoints = points
    .map((point) => {
      if (!point || typeof point !== "object") return null;
      const txid = (point as { txid?: unknown }).txid;
      const vout = (point as { vout?: unknown }).vout;
      if (typeof txid !== "string" || !/^[0-9a-fA-F]{64}$/.test(txid) || typeof vout !== "number") return null;
      return { txid, vout };
    })
    .filter((point): point is { txid: string; vout: number } => point !== null);
  let flags: (boolean | null)[];
  try {
    const ready = corePoints.length === 0 ? true : (await tipReady("core")) && (await sharedGenesis());
    flags = [];
    for (const point of corePoints) {
      if (!ready) {
        flags.push(null);
        continue;
      }
      flags.push(outputGone(true, readTxOut(await nodeRpc("core", "gettxout", [point.txid, point.vout, false]))));
    }
  } catch (err) {
    return { error: scrubRpcText(err instanceof Error ? err.message : "Core did not answer.") };
  }
  const step = nextWave({
    coreFileCount: corePoints.length,
    coreInputsSpent: coreInputsSpent(flags),
    knotsSent: false,
  });
  const statuses: { name: string; status: RowStatus }[] = [];
  for (const row of named) {
    if (!row || typeof row !== "object") continue;
    const name = (row as { name?: unknown }).name;
    const txid = (row as { txid?: unknown }).txid;
    const flavor = (row as { flavor?: unknown }).flavor;
    if (typeof name !== "string" || typeof txid !== "string" || (flavor !== "core" && flavor !== "knots")) continue;
    const rawPoints = Array.isArray((row as { points?: unknown }).points) ? (row as { points: unknown[] }).points : [];
    const rowPoints = rawPoints
      .map((point) => {
        if (!point || typeof point !== "object") return null;
        const id = (point as { txid?: unknown }).txid;
        const vout = (point as { vout?: unknown }).vout;
        if (typeof id !== "string" || !/^[0-9a-fA-F]{64}$/.test(id) || typeof vout !== "number") return null;
        return { txid: id, vout };
      })
      .filter((point): point is { txid: string; vout: number } => point !== null);
    statuses.push({ name, status: await txStatus(flavor, txid, rowPoints) });
  }
  return { phase: step.phase, reason: step.reason, rows: statuses, rdts: await rdts() };
}

async function txStatus(
  flavor: Flavor,
  txid: string,
  points: { txid: string; vout: number }[]
): Promise<RowStatus> {
  try {
    let inMempool = false;
    try {
      await nodeRpc(flavor, "getmempoolentry", [txid]);
      inMempool = true;
    } catch {
      inMempool = false;
    }
    let confirmed: { height: number; hash: string } | null = null;
    let hashAtHeight: string | null = null;
    try {
      const raw = await nodeRpc(flavor, "getrawtransaction", [txid, true]);
      if (raw && typeof raw === "object") {
        const blockhash = (raw as { blockhash?: unknown }).blockhash;
        if (typeof blockhash === "string") {
          confirmed = { height: 0, hash: blockhash };
          hashAtHeight = blockhash;
          try {
            const block = await nodeRpc(flavor, "getblock", [blockhash, 1]);
            const height = block && typeof block === "object" ? (block as { height?: unknown }).height : null;
            if (typeof height === "number") {
              confirmed = { height, hash: blockhash };
              const now = await nodeRpc(flavor, "getblockhash", [height]);
              hashAtHeight = typeof now === "string" ? now : blockhash;
            }
          } catch {
            hashAtHeight = blockhash;
          }
        }
      }
    } catch {
      confirmed = null;
    }
    let taken = false;
    if (!inMempool && !confirmed && points.length > 0) {
      const ready = await tipReady(flavor);
      for (const point of points) {
        try {
          const view = readTxOut(await nodeRpc(flavor, "gettxout", [point.txid, point.vout, true]));
          if (outputGone(ready, view) === true) taken = true;
        } catch {
          return "missing";
        }
      }
    }
    return rowStatus({
      ourTxid: txid,
      inMempool,
      spenders: taken ? ["other"] : [],
      confirmed,
      hashAtConfirmedHeight: hashAtHeight,
    });
  } catch {
    return "missing";
  }
}
