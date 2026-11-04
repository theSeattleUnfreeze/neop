/**
 * Watch a sent batch on the node that accepted it.
 * Shows mempool entries, a different transaction spending the same inputs,
 * confirmations, and a reorg. Does not broadcast.
 *
 * node scripts/watch-wave.mjs --dir "FOLDER"
 */

import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { isIP, connect as netConnect } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import type { Socket } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { httpHost, tlsRejectUnauthorized, tlsServerName } from "../scoop/src/lib/broadcast/wave.ts";
import {
  blockGapOdds,
  feeRateSatPerVbyte,
  freshIds,
  rowStatus,
  type ChainBlock,
  type RowStatus,
} from "../scoop/src/lib/broadcast/watch.ts";

const require = createRequire(fileURLToPath(new URL("../scoop/package.json", import.meta.url)));
const bitcoin = require("bitcoinjs-lib") as typeof import("bitcoinjs-lib");

type Endpoint = { url: string; user?: string; password?: string; cookieFile?: string; tlsInsecure?: boolean };
type Config = { socks?: string; core: Endpoint; knots: Endpoint };
type Point = { txid: string; vout: number };
type Watched = { name: string; txid: string; inputs: Point[] };
type Rpc = { call(method: string, params: unknown[]): Promise<unknown> };
type MempoolView = { feeRate: number | null; vsize: number | null; replaceable: boolean | null; enteredAt: number | null };
type Row = {
  item: Watched;
  status: RowStatus;
  confirmations: number;
  ours: MempoolView | null;
  conflicts: { input: number; txid: string; feeRate: number | null; inBlock: boolean }[];
};

const args = process.argv.slice(2);
const RED = "\x1b[41;97;1m";
const YELLOW = "\x1b[43;30;1m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function dirs(): string[] {
  const found: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--dir" && args[i + 1]) found.push(args[i + 1]);
  }
  return found;
}

function authOf(endpoint: Endpoint, label: string): { user: string; password: string } {
  if (endpoint.user && endpoint.password) return { user: endpoint.user, password: endpoint.password };
  if (endpoint.cookieFile) {
    const raw = readFileSync(endpoint.cookieFile, "utf8").trim();
    const i = raw.indexOf(":");
    if (i < 1) throw new Error(`${label} RPC cookie file is not user:password`);
    return { user: raw.slice(0, i), password: raw.slice(i + 1) };
  }
  throw new Error(`${label} RPC credentials are missing from the config.`);
}

function loadConfig(path: string): Config {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Config;
  if (!parsed.core?.url || !parsed.knots?.url) throw new Error("Config needs core.url and knots.url.");
  return parsed;
}

function socksConnect(proxy: string, host: string, port: number): Promise<Socket> {
  const [proxyHost, proxyPortRaw] = proxy.split(":");
  const proxyPort = Number(proxyPortRaw);
  return new Promise((resolveSock, reject) => {
    const socket = netConnect(proxyPort, proxyHost);
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.once("error", fail);
    socket.once("connect", () => {
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
      const chunks: Buffer[] = [];
      let sent = false;
      const onData = (chunk: Buffer) => {
        chunks.push(chunk);
        const buf = Buffer.concat(chunks);
        if (!sent) {
          if (buf.length < 2) return;
          if (buf[0] !== 0x05 || buf[1] !== 0x00) {
            socket.off("data", onData);
            fail(new Error("Tor SOCKS rejected the greeting"));
            return;
          }
          sent = true;
          const name = Buffer.from(host);
          const req = Buffer.alloc(7 + name.length);
          req[0] = 0x05;
          req[1] = 0x01;
          req[2] = 0x00;
          req[3] = 0x03;
          req[4] = name.length;
          name.copy(req, 5);
          req.writeUInt16BE(port, 5 + name.length);
          socket.write(req);
          chunks.length = 0;
          return;
        }
        if (buf.length < 5) return;
        const atyp = buf[3];
        const need = atyp === 0x01 ? 10 : atyp === 0x04 ? 22 : 7 + buf[4];
        if (buf.length < need) return;
        socket.off("data", onData);
        if (buf[1] !== 0x00) {
          fail(new Error(`Tor could not reach the node (${buf[1]})`));
          return;
        }
        socket.removeListener("error", fail);
        resolveSock(socket);
      };
      socket.on("data", onData);
    });
  });
}

function openRpc(endpoint: Endpoint, label: string, socks?: string): Rpc {
  const url = new URL(endpoint.url);
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  const auth = authOf(endpoint, label);
  const header = Buffer.from(`${auth.user}:${auth.password}`).toString("base64");
  return {
    async call(method: string, params: unknown[]): Promise<unknown> {
      const body = JSON.stringify({ jsonrpc: "1.0", id: "watch", method, params });
      const raw = socks
        ? await socksConnect(socks, url.hostname, port)
        : await new Promise<Socket>((resolveSock, reject) => {
            const socket = netConnect(port, url.hostname);
            socket.once("error", reject);
            socket.once("connect", () => resolveSock(socket));
          });
      const socket: Socket | TLSSocket =
        url.protocol === "https:"
          ? tlsConnect({
              socket: raw,
              servername: tlsServerName(url.hostname, isIP(url.hostname)),
              rejectUnauthorized: tlsRejectUnauthorized(endpoint.tlsInsecure),
            })
          : raw;
      if (url.protocol === "https:") {
        await new Promise<void>((resolveReady, reject) => {
          socket.once("secureConnect", () => resolveReady());
          socket.once("error", reject);
        });
      }
      const hostHeader = httpHost(url.hostname, url.port, isIP(url.hostname));
      const req =
        `POST ${url.pathname || "/"} HTTP/1.1\r\n` +
        `Host: ${hostHeader}\r\n` +
        `Authorization: Basic ${header}\r\n` +
        `Content-Type: application/json\r\n` +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        `Connection: close\r\n\r\n` +
        body;
      socket.write(req);
      const text = await new Promise<string>((resolveText, reject) => {
        const chunks: Buffer[] = [];
        socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        socket.on("error", reject);
        socket.on("end", () => resolveText(Buffer.concat(chunks).toString("utf8")));
      });
      const splitAt = text.indexOf("\r\n\r\n");
      const status = Number(text.split(" ")[1]);
      if (status === 401) throw new Error(`${label} RPC authentication failed`);
      const payload = splitAt >= 0 ? text.slice(splitAt + 4) : text;
      const parsed = JSON.parse(payload) as { result?: unknown; error?: { message?: string } | null };
      if (parsed.error) throw new Error(parsed.error.message || `${label} RPC error`);
      return parsed.result;
    },
  };
}

function fromPsbt(psbt: import("bitcoinjs-lib").Psbt): import("bitcoinjs-lib").Transaction {
  const needsFinalize = psbt.data.inputs.some((input) => !input.finalScriptSig?.length && !input.finalScriptWitness?.length);
  if (needsFinalize) psbt.finalizeAllInputs();
  return psbt.extractTransaction();
}

function txFromBytes(bytes: Buffer): import("bitcoinjs-lib").Transaction {
  if (bytes.length >= 5 && bytes.subarray(0, 4).toString("ascii") === "psbt" && bytes[4] === 0xff) {
    return fromPsbt(bitcoin.Psbt.fromBuffer(bytes));
  }
  const text = bytes.toString("utf8").trim();
  if (text.startsWith("cHNidP")) return fromPsbt(bitcoin.Psbt.fromBase64(text.replace(/\s+/g, "")));
  throw new Error("not a psbt");
}

function loadDir(dir: string): Watched[] {
  const out: Watched[] = [];
  for (const name of readdirSync(dir).filter((entry) => entry.toLowerCase().endsWith(".psbt") && !entry.startsWith("."))) {
    const tx = txFromBytes(readFileSync(join(dir, name)));
    out.push({
      name,
      txid: tx.getId(),
      inputs: tx.ins.map((input) => ({ txid: Buffer.from(input.hash).reverse().toString("hex"), vout: input.index })),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function mempoolView(entry: unknown): MempoolView | null {
  if (!entry || typeof entry !== "object") return null;
  const row = entry as {
    vsize?: number;
    time?: number;
    "bip125-replaceable"?: boolean;
    fees?: { base?: number };
  };
  const vsize = typeof row.vsize === "number" ? row.vsize : null;
  const feeSats = typeof row.fees?.base === "number" ? Math.round(row.fees.base * 1e8) : null;
  return {
    vsize,
    feeRate: feeSats !== null && vsize !== null ? feeRateSatPerVbyte(feeSats, vsize) : null,
    replaceable: typeof row["bip125-replaceable"] === "boolean" ? row["bip125-replaceable"] : null,
    enteredAt: typeof row.time === "number" ? row.time : null,
  };
}

function shortId(id: string): string {
  return id.slice(0, 10);
}

function age(seconds: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - seconds) / 60));
  if (minutes < 90) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}

function pad(text: string, width: number): string {
  const raw = [...text].slice(0, width).join("");
  return raw + " ".repeat(Math.max(0, width - raw.length));
}

function paint(input: {
  chain: string;
  tip: number;
  blockTime: number;
  now: number;
  rows: Row[];
  reorgHeights: number[];
  error: string | null;
}): string {
  const minutes = Math.max(0, (input.now / 1000 - input.blockTime) / 60);
  const odds = blockGapOdds(minutes);
  const confirmed = input.rows.filter((row) => row.status === "confirmed").length;
  const lines = [
    `neop watch  ${input.chain}  ${confirmed}/${input.rows.length} mined  tip ${input.tip}  last block ${age(input.blockTime, input.now / 1000)}  ${DIM}${(odds * 100).toFixed(1)}% of waits last at least this long${RESET}`,
    `${DIM}q quits. Another spend of the same input is a conflict. A moved block hash is a reorg.${RESET}`,
    "",
  ];
  if (input.reorgHeights.length) {
    lines.push(`${RED} REORG  block hash changed at height ${input.reorgHeights.join(", ")} ${RESET}`);
    lines.push(`${RED} A confirmation was on a block that is no longer the best chain. ${RESET}`);
    lines.push("");
  }
  if (input.error) lines.push(`${YELLOW} ${input.error} ${RESET}`, "");
  lines.push(`${DIM}${pad("STATE", 10)}${pad("CONF", 6)}${pad("sat/vB", 8)}${pad("RBF", 5)}FILE${RESET}`);
  for (const row of input.rows) {
    const state = row.status === "confirmed" ? `${GREEN}mined${RESET}` : row.status === "conflict" || row.status === "reorged" ? `${RED}${row.status}${RESET}` : row.status;
    const conf = row.status === "confirmed" ? String(row.confirmations) : "-";
    const rate = row.ours?.feeRate !== null && row.ours?.feeRate !== undefined ? row.ours.feeRate.toFixed(1) : "-";
    const rbf = row.ours?.replaceable === true ? "yes" : row.ours?.replaceable === false ? "no" : "-";
    const plainState = row.status === "confirmed" ? "mined" : row.status;
    const colorWidth = state.length - plainState.length;
    lines.push(`${pad(state, 10 + colorWidth)}${pad(conf, 6)}${pad(rate, 8)}${pad(rbf, 5)}${row.item.name}`);
    for (const conflict of row.conflicts) {
      const theirRate = conflict.feeRate === null ? "" : `  ${conflict.feeRate.toFixed(1)} sat/vB`;
      const where = conflict.inBlock ? "in a block" : "in the mempool";
      lines.push(`  ${YELLOW}input ${conflict.input + 1} spent by ${shortId(conflict.txid)}${theirRate} ${where}${RESET}`);
    }
  }
  return lines.join("\n") + "\n";
}

function notify(title: string, body: string) {
  process.stdout.write("\x07");
  if (process.platform !== "win32") return;
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const command = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "$n = New-Object System.Windows.Forms.NotifyIcon",
    "$n.Icon = [System.Drawing.SystemIcons]::Warning",
    "$n.Visible = $true",
    `$n.ShowBalloonTip(8000, ${quote(title)}, ${quote(body)}, 'Warning')`,
    "Start-Sleep -Seconds 2",
    "$n.Dispose()",
  ].join("; ");
  execFile("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", command], { windowsHide: true });
}

async function blockAt(rpc: Rpc, height: number): Promise<{ hash: string; tx: string[]; time: number }> {
  const hash = String(await rpc.call("getblockhash", [height]));
  const block = (await rpc.call("getblock", [hash, 1])) as { tx?: string[]; time?: number };
  return { hash, tx: block.tx ?? [], time: block.time ?? 0 };
}

async function poll(
  rpc: Rpc,
  items: Watched[],
  remembered: Map<string, ChainBlock>,
  lost: Map<string, ChainBlock>,
  hashes: Map<number, string>,
  backfillTo: { height: number },
  reorgLatch: Set<number>
) {
  const tip = Number(await rpc.call("getblockcount", []));
  const start = Math.max(0, Math.min(backfillTo.height, tip - 6));
  let blockTime = 0;
  for (let height = start; height <= tip; height += 1) {
    const hash = String(await rpc.call("getblockhash", [height]));
    const previous = hashes.get(height);
    if (previous && previous !== hash) reorgLatch.add(height);
    if (previous === hash && height !== tip) continue;
    const block = await blockAt(rpc, height);
    hashes.set(height, block.hash);
    if (height === tip) blockTime = block.time;
    for (const item of items) {
      if (block.tx.includes(item.txid)) {
        remembered.set(item.txid, { height, hash: block.hash });
        lost.delete(item.txid);
      } else if (previous && previous !== block.hash && remembered.get(item.txid)?.hash === previous) {
        lost.set(item.txid, remembered.get(item.txid)!);
        remembered.delete(item.txid);
      }
    }
  }
  backfillTo.height = tip + 1;

  const points = items.flatMap((item) => item.inputs.map((input) => ({ txid: input.txid, vout: input.vout })));
  let spent: { spendingtxid?: string | null }[] = [];
  let spendWarning: string | null = null;
  try {
    spent = (await rpc.call("gettxspendingprevout", [points])) as { spendingtxid?: string | null }[];
  } catch {
    spendWarning = "Could not list other spends of these inputs.";
    spent = points.map(() => ({}));
  }
  let cursor = 0;
  const spenders = new Map<string, (string | null)[]>();
  for (const item of items) {
    spenders.set(
      item.txid,
      item.inputs.map(() => {
        const row = spent[cursor];
        cursor += 1;
        return row?.spendingtxid ?? null;
      })
    );
  }

  const entries = await Promise.all(
    items.map(async (item) => {
      try {
        return mempoolView(await rpc.call("getmempoolentry", [item.txid]));
      } catch {
        return null;
      }
    })
  );

  const otherIds = new Set<string>();
  for (const item of items) {
    for (const id of spenders.get(item.txid) ?? []) {
      if (id && id !== item.txid) otherIds.add(id);
    }
  }
  const otherFee = new Map<string, { feeRate: number | null; inBlock: boolean }>();
  await Promise.all(
    [...otherIds].map(async (id) => {
      try {
        const view = mempoolView(await rpc.call("getmempoolentry", [id]));
        otherFee.set(id, { feeRate: view?.feeRate ?? null, inBlock: false });
      } catch {
        otherFee.set(id, { feeRate: null, inBlock: true });
      }
    })
  );

  const rows: Row[] = items.map((item, index) => {
    const seen = remembered.get(item.txid) ?? lost.get(item.txid) ?? null;
    const status = rowStatus({
      ourTxid: item.txid,
      inMempool: entries[index] !== null,
      spenders: spenders.get(item.txid) ?? [],
      confirmed: seen,
      hashAtConfirmedHeight: seen ? hashes.get(seen.height) ?? null : null,
    });
    const conflicts = (spenders.get(item.txid) ?? []).flatMap((id, input) => {
      if (!id || id === item.txid) return [];
      const other = otherFee.get(id);
      return [{ input, txid: id, feeRate: other?.feeRate ?? null, inBlock: other?.inBlock ?? false }];
    });
    return {
      item,
      status,
      confirmations: seen && status === "confirmed" ? tip - seen.height + 1 : 0,
      ours: entries[index],
      conflicts,
    };
  });
  return { tip, blockTime, rows, reorgHeights: [...reorgLatch], spendWarning };
}

function notifyTransitions(rows: Row[], mined: Set<string>, conflicts: Set<string>, reorgSeen: { on: boolean }, reorgNow: boolean) {
  const minedNow = freshIds(mined, new Set(rows.filter((row) => row.status === "confirmed").map((row) => row.item.txid)));
  for (const id of minedNow) mined.add(id);
  if (minedNow.length) notify("neop", `${minedNow.length} watched transaction${minedNow.length === 1 ? "" : "s"} mined. ${mined.size} confirmed in this batch.`);
  const conflictNow = freshIds(conflicts, new Set(rows.filter((row) => row.conflicts.length > 0).map((row) => row.item.txid)));
  for (const id of conflictNow) conflicts.add(id);
  if (conflictNow.length) notify("neop warning", "Another transaction is spending an input from this batch.");
  if (reorgNow && !reorgSeen.on) notify("neop REORG", "A block hash moved. A confirmation may have left the best chain.");
  reorgSeen.on = reorgNow;
}

async function main() {
  const folders = dirs();
  if (!folders.length) {
    console.error("Usage: node scripts/watch-wave.mjs --dir FOLDER [--dir FOLDER] [--chain core|knots] [--once]");
    process.exit(2);
  }
  const chain = flag("--chain") === "knots" ? "knots" : "core";
  const once = args.includes("--once");
  const items = folders.flatMap((dir) => loadDir(resolve(dir)));
  if (!items.length) throw new Error("Those folders have no PSBT files.");
  const config = loadConfig(flag("--config") || join(homedir(), ".neop", "broadcast.json"));
  const endpoint = config[chain];
  const socks = chain === "core" ? config.socks || "127.0.0.1:9150" : undefined;
  const rpc = openRpc(endpoint, chain === "core" ? "Core" : "Knots", socks);
  const remembered = new Map<string, ChainBlock>();
  const lost = new Map<string, ChainBlock>();
  const hashes = new Map<number, string>();
  const reorgLatch = new Set<number>();
  const tipNow = Number(await rpc.call("getblockcount", []));
  const backfillTo = { height: Math.max(0, tipNow - 30) };
  const mined = new Set<string>();
  const conflicts = new Set<string>();
  const reorgSeen = { on: false };
  const interactive = Boolean(process.stdout.isTTY) && !once;
  if (interactive) {
    process.stdout.write("\x1b[?1049h\x1b[?25l");
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on("data", (key) => {
      if (key[0] === 3 || key[0] === 113) stop();
    });
  }
  let stopped = false;
  const stop = () => {
    stopped = true;
    if (interactive) process.stdout.write("\x1b[?25h\x1b[?1049l");
    process.exit(0);
  };
  process.on("SIGINT", stop);

  do {
    let screen = "";
    try {
      const frame = await poll(rpc, items, remembered, lost, hashes, backfillTo, reorgLatch);
      const reorgNow = frame.reorgHeights.length > 0 || frame.rows.some((row) => row.status === "reorged");
      if (!once) notifyTransitions(frame.rows, mined, conflicts, reorgSeen, reorgNow);
      screen = paint({
        chain,
        tip: frame.tip,
        blockTime: frame.blockTime,
        now: Date.now(),
        rows: frame.rows,
        reorgHeights: frame.reorgHeights,
        error: frame.spendWarning,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      screen = paint({
        chain,
        tip: tipNow,
        blockTime: Math.floor(Date.now() / 1000),
        now: Date.now(),
        rows: [],
        reorgHeights: [],
        error: message.replace(/[0-9a-fA-F]{16,}/g, "…").slice(0, 160),
      });
    }
    if (interactive) process.stdout.write(`\x1b[H\x1b[2J${screen}`);
    else process.stdout.write(screen);
    if (once || stopped) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 5_000));
  } while (!stopped);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.replace(/[0-9a-fA-F]{16,}/g, "…").slice(0, 160));
  process.exit(1);
});
