/**
 * Which files a guided split is allowed to send.
 * The method name is not trusted: the files still have to match it.
 */

import {
  nextWave,
  pairWave,
  type CoinNeed,
  type PairProblem,
  type SignedFile,
  type WavePhase,
} from "@/lib/broadcast/pairWave";

export type SplitMethod = "core-garnish" | "unified-sighash" | "drain";

export function parseSplitMethod(value: unknown): SplitMethod | null | { error: string } {
  if (value === undefined || value === null || value === "") return null;
  if (value === "core-garnish" || value === "unified-sighash" || value === "drain") return value;
  return { error: "Unknown split method." };
}

/** Reduced-data expiry matters for the methods that send a long OP_RETURN. */
export function rdtsApplies(method: SplitMethod): boolean {
  return method !== "unified-sighash";
}

export function expectedWave(method: SplitMethod, need: CoinNeed): { core: number; knots: number } | null {
  if (need === "unknown") return null;
  if (need === "core-only") return { core: 1, knots: 0 };
  if (need === "knots-only") return { core: 0, knots: 1 };
  if (method === "core-garnish") return { core: 1, knots: 0 };
  if (method === "unified-sighash") return { core: 0, knots: 1 };
  return { core: 1, knots: 1 };
}

export function methodNeedText(method: SplitMethod, need: CoinNeed | "mixed"): string | null {
  if (need !== "needs-split") return null;
  if (method === "core-garnish") {
    return "Still unspent on both chains. This method sends one Core file and leaves the Knots coin in the wallet.";
  }
  if (method === "unified-sighash") {
    return "Still unspent on both chains. This method sends one unified-sighash file and leaves the Core coin in the wallet.";
  }
  return null;
}

function countMismatch(method: SplitMethod): string {
  if (method === "core-garnish") {
    return "This method sends one Core file for each coin and leaves the Knots coin in the wallet.";
  }
  return "This method sends one unified-sighash file for each coin and leaves the Core coin in the wallet.";
}

export function pairWaveForMethod(
  files: SignedFile[],
  catalog: Record<string, CoinNeed>,
  method: SplitMethod
): { ok: boolean; problems: PairProblem[] } {
  if (method === "drain") return pairWave(files, catalog);
  const problems: PairProblem[] = [];
  if (files.length === 0) return { ok: false, problems: [{ message: "No signed files." }] };

  for (const file of files) {
    if (!file.flavor) {
      problems.push({ message: `${file.name}: ${file.why}` });
      continue;
    }
    if (file.inputCount !== 1) {
      problems.push({ message: `${file.name} spends ${file.inputCount} inputs. One coin per transaction.` });
    }
    if (method === "core-garnish" && file.flavor !== "core") {
      problems.push({ message: `${file.name} is not a Core file with a long OP_RETURN.` });
    }
    if (method === "unified-sighash" && (file.flavor !== "knots" || file.why !== "unified-sighash")) {
      problems.push({ message: `${file.name} is not a Knots file with unified sighash.` });
    }
  }

  const byPoint = new Map<string, SignedFile[]>();
  for (const file of files) {
    if (!file.flavor) continue;
    for (const point of file.outpoints) {
      const list = byPoint.get(point) ?? [];
      list.push(file);
      byPoint.set(point, list);
    }
  }

  for (const [point, group] of byPoint) {
    const need = catalog[point] ?? "unknown";
    if (need === "unknown") {
      problems.push({
        message: "Scoop does not know this coin, so it cannot tell whether a spend of it can be replayed.",
      });
      continue;
    }
    const cores = group.filter((file) => file.flavor === "core");
    const knots = group.filter((file) => file.flavor === "knots");
    const expect = expectedWave(method, need);
    if (!expect || cores.length !== expect.core || knots.length !== expect.knots) {
      problems.push({ message: countMismatch(method) });
      continue;
    }
    if (need === "needs-split" && method === "core-garnish" && cores.some((file) => file.why !== "long-op-return")) {
      problems.push({ message: "A Core file for this method needs a long OP_RETURN." });
    }
  }

  return { ok: problems.length === 0, problems };
}

/** Every listed coin has its signed files, and nothing extra was dropped. */
export function coversQueue(
  method: SplitMethod,
  queued: string[],
  files: SignedFile[]
): { ok: boolean; problems: PairProblem[] } {
  const problems: PairProblem[] = [];
  const seen = new Map<string, SignedFile[]>();
  for (const file of files) {
    for (const point of file.outpoints) {
      const key = point.toLowerCase();
      const list = seen.get(key) ?? [];
      list.push(file);
      seen.set(key, list);
    }
  }
  const wanted = new Set(queued.map((point) => point.toLowerCase()));
  for (const point of wanted) {
    const group = seen.get(point) ?? [];
    const cores = group.filter((file) => file.flavor === "core").length;
    const knots = group.filter((file) => file.flavor === "knots").length;
    const expect = expectedWave(method, "needs-split");
    if (!expect || cores !== expect.core || knots !== expect.knots) {
      problems.push({ message: "A listed coin is missing its signed file." });
    }
  }
  for (const point of seen.keys()) {
    if (!wanted.has(point)) {
      problems.push({ message: "A file spends a coin that is not in this split." });
    }
  }
  return { ok: problems.length === 0, problems };
}

export function nextWaveForMethod(
  method: SplitMethod | null,
  input: {
    coreFileCount: number;
    knotsFileCount?: number;
    coreInputsSpent: boolean | null;
    knotsSent: boolean;
  }
): { phase: WavePhase; reason: string } {
  if (method === "core-garnish") {
    if (input.knotsSent) return { phase: "done", reason: "Knots wave already sent." };
    if (input.coreFileCount < 1) return { phase: "done", reason: "No Core files." };
    if (input.coreInputsSpent === true) {
      return { phase: "done", reason: "The Core transactions are in a block. The Knots coins stay in this wallet." };
    }
    return {
      phase: "hold",
      reason: "Waiting for the Core transactions to confirm. The Knots coins stay in this wallet.",
    };
  }
  if (method === "unified-sighash") {
    if (input.knotsSent) return { phase: "done", reason: "Knots wave already sent." };
    return { phase: "send-knots", reason: "Unified sighash spends Knots only. The Core coins stay in this wallet." };
  }
  return nextWave(input);
}

export function chainLane(method: SplitMethod, chain: "core" | "knots"): "moving" | "staying" {
  if (method === "drain") return "moving";
  if (method === "core-garnish") return chain === "core" ? "moving" : "staying";
  return chain === "knots" ? "moving" : "staying";
}
