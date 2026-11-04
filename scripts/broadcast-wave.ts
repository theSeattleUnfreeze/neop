/**
 * Broadcast a Core folder and a Knots folder only after every transaction
 * passes testmempoolaccept on its own node. See scripts/BROADCAST-WAVE.md.
 */

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { connect as netConnect, isIP } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import type { Socket } from "node:net";
import { fileURLToPath } from "node:url";
import {
  chainTipReady,
  coreProblems,
  hasCoreWedge,
  httpHost,
  jitterMs,
  knotsAfterCoreProblems,
  broadcastAbortFooter,
  mayBroadcast,
  outputGone,
  readMempoolAccept,
  readTxOut,
  sameNetwork,
  tlsRejectUnauthorized,
  tlsServerName,
  type MempoolVerdict,
  type TxOutView,
} from "../scoop/src/lib/broadcast/wave.ts";
import { garnishUnsignedPsbt, nextWedge, wedgeCycleStart } from "../scoop/src/lib/psbt/garnish.ts";

const require = createRequire(fileURLToPath(new URL("../scoop/package.json", import.meta.url)));
const bitcoin = require("bitcoinjs-lib") as typeof import("bitcoinjs-lib");

type Endpoint = {
  url: string;
  user?: string;
  password?: string;
  cookieFile?: string;
  tlsInsecure?: boolean;
};

type BroadcastConfig = {
  socks?: string;
  core: Endpoint;
  knots: Endpoint;
};

type SpentPoint = { txid: string; vout: number };

type Ready = {
  name: string;
  hex: string;
  txid: string;
  inputs: SpentPoint[];
  wedge: boolean;
};

type Rpc = {
  call(method: string, params: unknown[]): Promise<unknown>;
  close(): void;
};

const args = process.argv.slice(2);
/** Set after the first successful Core sendrawtransaction (partial batch counts). */
let coreAlreadySent = false;
/** Set after the first successful Knots sendrawtransaction (partial batch counts). */
let knotsAlreadySent = false;

function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  return args[i + 1];
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

function loadConfig(path: string): BroadcastConfig {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as BroadcastConfig;
  if (!parsed.core?.url || !parsed.knots?.url) throw new Error("Config needs core.url and knots.url.");
  return parsed;
}

function listFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => !name.startsWith("."))
    .map((name) => join(dir, name))
    .sort();
}

function txFromBytes(bytes: Buffer): import("bitcoinjs-lib").Transaction {
  if (bytes.length >= 5 && bytes.subarray(0, 4).toString("ascii") === "psbt" && bytes[4] === 0xff) {
    return fromPsbt(bitcoin.Psbt.fromBuffer(bytes));
  }
  const text = bytes.toString("utf8").trim();
  if (text.startsWith("cHNidP")) {
    return fromPsbt(bitcoin.Psbt.fromBase64(text.replace(/\s+/g, "")));
  }
  const hex = text.replace(/\s+/g, "");
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length >= 20) return bitcoin.Transaction.fromHex(hex);
  return bitcoin.Transaction.fromBuffer(bytes);
}

function fromPsbt(psbt: import("bitcoinjs-lib").Psbt): import("bitcoinjs-lib").Transaction {
  const needsFinalize = psbt.data.inputs.some((input) => !input.finalScriptSig?.length && !input.finalScriptWitness?.length);
  if (needsFinalize) psbt.finalizeAllInputs();
  return psbt.extractTransaction();
}

type CoreFile = {
  ready?: Ready;
  status: "ready" | "unsigned" | "partial" | "unreadable" | "invalid";
  detail?: string;
};

function inspectCoreFile(bytes: Buffer): CoreFile {
  let psbt: import("bitcoinjs-lib").Psbt | undefined;
  if (bytes.length >= 5 && bytes.subarray(0, 4).toString("ascii") === "psbt" && bytes[4] === 0xff) {
    psbt = bitcoin.Psbt.fromBuffer(bytes);
  } else {
    const text = bytes.toString("utf8").trim();
    if (text.startsWith("cHNidP")) psbt = bitcoin.Psbt.fromBase64(text.replace(/\s+/g, ""));
  }
  if (!psbt) {
    try {
      const tx = txFromBytes(bytes);
      const problems = coreProblems(tx);
      if (problems.length) return { status: "invalid", detail: problems[0] };
      return { status: "ready", ready: { name: "", hex: tx.toHex(), txid: tx.getId(), inputs: inputPoints(tx), wedge: hasCoreWedge(tx) } };
    } catch {
      return { status: "unreadable" };
    }
  }
  const wedge = psbt.txOutputs.some((out) => out.script.length > 83 && out.script[0] === 0x6a);
  const inputs = psbt.data.inputs;
  const finalized = inputs.every((input) => input.finalScriptSig?.length || input.finalScriptWitness?.length);
  const partial = inputs.some((input) => (input.partialSig?.length ?? 0) > 0 || input.tapKeySig?.length || (input.tapScriptSig?.length ?? 0) > 0);
  if (!wedge) return { status: "invalid", detail: "OP_RETURN script is not longer than 83 bytes" };
  if (psbt.inputCount !== 1) return { status: "invalid", detail: "more than one input" };
  if (!finalized && !partial) return { status: "unsigned" };
  try {
    if (!finalized) psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction();
    const problems = coreProblems(tx);
    if (problems.length) return { status: "invalid", detail: problems[0] };
    return { status: "ready", ready: { name: "", hex: tx.toHex(), txid: tx.getId(), inputs: inputPoints(tx), wedge: true } };
  } catch {
    return { status: partial ? "partial" : "unsigned" };
  }
}

function loadCoreFiles(dir: string): CoreFile[] {
  const files = listFiles(dir).filter((path) => path.toLowerCase().endsWith(".psbt"));
  if (files.length === 0) return [{ status: "unreadable", detail: "folder has no PSBT files" }];
  return files.map((path) => {
    try {
      return inspectCoreFile(readFileSync(path));
    } catch {
      return { status: "unreadable" };
    }
  });
}
function inputPoints(tx: import("bitcoinjs-lib").Transaction): SpentPoint[] {
  return tx.ins.map((input) => ({
    txid: Buffer.from(input.hash).reverse().toString("hex"),
    vout: input.index,
  }));
}

function pointKey(point: SpentPoint): string {
  return `${point.txid}:${point.vout}`;
}

function loadDir(dir: string, chain: "core" | "knots"): { ready: Ready[]; errors: string[] } {
  const ready: Ready[] = [];
  const errors: string[] = [];
  const files = listFiles(dir).filter((path) => path.toLowerCase().endsWith(".psbt"));
  for (const path of files) {
    const name = path.split(/[/\\]/).pop() || path;
    try {
      const tx = txFromBytes(readFileSync(path));
      const wedge = hasCoreWedge(tx);
      const problems =
        chain === "core" ? coreProblems(tx, wedge ? undefined : { knotsAbsent: true }) : knotsAfterCoreProblems(tx);
      if (problems.length) {
        errors.push(problems[0]);
        continue;
      }
      ready.push({ name, hex: tx.toHex(), txid: tx.getId(), inputs: inputPoints(tx), wedge });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(/finali[sz]e/i.test(message) ? "not fully signed" : "could not read as a signed transaction");
    }
  }
  if (files.length === 0) errors.push("folder has no PSBT files");
  return { ready, errors };
}

function tally(errors: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const error of errors) {
    const reason = error.includes("inputs")
      ? "more than one input"
      : error.includes("OP_RETURN")
        ? "OP_RETURN script is not longer than 83 bytes"
        : error.includes("no signature")
          ? "no signature"
          : error.includes("unified sighash")
            ? "unified sighash present"
            : error;
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return counts;
}

function safeRejectReason(reason: string | undefined): string {
  if (!reason) return "rejected";
  const cleaned = reason.replace(/[0-9a-fA-F]{16,}/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 120) return "rejected";
  return cleaned;
}

function socksConnect(proxy: string, host: string, port: number): Promise<Socket> {
  const [proxyHost, proxyPortRaw] = proxy.split(":");
  const proxyPort = Number(proxyPortRaw);
  return new Promise((resolve, reject) => {
    const socket = netConnect(proxyPort, proxyHost);
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.setTimeout(25_000, () => fail(new Error("Core connection timed out")));
    socket.once("error", fail);
    socket.once("connect", () => {
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
      const chunks: Buffer[] = [];
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
            const reason =
              buf[1] === 0xf0
                ? "onion descriptor not found"
                : buf[1] === 0xf1
                  ? "onion descriptor invalid"
                  : buf[1] === 0xf2
                    ? "onion introduction failed"
                    : buf[1] === 0xf3
                      ? "onion rendezvous failed"
                      : buf[1] === 0xf4
                        ? "onion client auth missing"
                        : buf[1] === 0xf5
                          ? "onion client auth rejected"
                          : buf[1] === 0xf6
                            ? "onion address invalid"
                            : buf[1] === 0xf7
                              ? "onion introduction timed out"
                              : `code ${buf[1]}`;
            fail(new Error(`Tor could not reach the Core node (${reason})`));
            return;
          }
          socket.removeListener("error", fail);
          resolve(socket);
        };
      let sent = false;
      socket.on("data", onData);
    });
  });
}

function openRpc(endpoint: Endpoint, label: string, socks?: string): Promise<Rpc> {
  const url = new URL(endpoint.url);
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  const auth = authOf(endpoint, label);
  const header = Buffer.from(`${auth.user}:${auth.password}`).toString("base64");

  async function call(method: string, params: unknown[]): Promise<unknown> {
    const body = JSON.stringify({ jsonrpc: "1.0", id: "wave", method, params });
    const raw = socks
      ? await socksConnect(socks, url.hostname, port)
      : await new Promise<Socket>((resolve, reject) => {
          const socket = netConnect(port, url.hostname);
          const fail = (err: Error) => {
            socket.destroy();
            reject(err);
          };
          socket.setTimeout(25_000, () => fail(new Error("Core connection timed out")));
          socket.once("error", fail);
          socket.once("connect", () => resolve(socket));
        });
    const socket: Socket | TLSSocket =
      url.protocol === "https:"
        ? tlsConnect({
            socket: raw,
            servername: tlsServerName(url.hostname, isIP(url.hostname)),
            rejectUnauthorized: tlsRejectUnauthorized(endpoint.tlsInsecure),
          })
        : raw;
    socket.setTimeout(25_000, () => socket.destroy(new Error("Core connection timed out")));
    if (url.protocol === "https:") {
      await new Promise<void>((resolve, reject) => {
        socket.once("secureConnect", () => resolve());
        socket.once("error", reject);
      });
    }
    const host = httpHost(url.hostname, url.port, isIP(url.hostname));
    const req =
      `POST ${url.pathname || "/"} HTTP/1.1\r\n` +
      `Host: ${host}\r\n` +
      `Authorization: Basic ${header}\r\n` +
      `Content-Type: application/json\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      `Connection: close\r\n\r\n` +
      body;
    socket.write(req);
    const text = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      socket.on("error", reject);
      socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    const splitAt = text.indexOf("\r\n\r\n");
    const status = Number(text.split(" ")[1]);
    if (status === 401) throw new Error(`${label} RPC authentication failed`);
    const payload = splitAt >= 0 ? text.slice(splitAt + 4) : text;
    const parsed = JSON.parse(payload) as { result?: unknown; error?: { message?: string } | null };
    if (parsed.error) throw new Error(parsed.error.message || `${label} RPC error`);
    return parsed.result;
  }

  return { call, close() {} };
}

async function preflight(rpc: Rpc, rows: Ready[], label: string): Promise<{ errors: string[]; verdicts: MempoolVerdict[] }> {
  const errors: string[] = [];
  const verdicts: MempoolVerdict[] = [];
  for (const row of rows) {
    try {
      const verdict = readMempoolAccept(await rpc.call("testmempoolaccept", [[row.hex], 0]));
      verdicts.push(verdict);
      if (!verdict.allowed) errors.push(`${row.name}: ${safeRejectReason(verdict.reason)}`);
      else console.log(`${label} ${row.name} preflight allowed`);
    } catch (err) {
      const reason = safeRejectReason(err instanceof Error ? err.message : String(err));
      verdicts.push({ allowed: false, reason });
      errors.push(`${row.name}: ${reason}`);
    }
  }
  return { errors, verdicts };
}

async function sendChain(
  rpc: Rpc,
  rows: Ready[],
  label: string,
  state: { stop: boolean },
  sent: string[],
  notSent: string[]
) {
  for (let i = 0; i < rows.length; i++) {
    if (state.stop) {
      notSent.push(...rows.slice(i).map((row) => `${label} ${row.name}`));
      return;
    }
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, jitterMs(Math.random())));
    if (state.stop) {
      notSent.push(...rows.slice(i).map((row) => `${label} ${row.name}`));
      return;
    }
    try {
      await rpc.call("sendrawtransaction", [rows[i].hex, 0]);
      if (label === "core") coreAlreadySent = true;
      if (label === "knots") knotsAlreadySent = true;
      sent.push(`${label} ${rows[i].name}`);
      console.log(`${label} ${rows[i].name} sent`);
    } catch (err) {
      state.stop = true;
      const reason = safeRejectReason(err instanceof Error ? err.message : String(err));
      console.error(`${label} ${rows[i].name} rejected: ${reason}`);
      notSent.push(`${label} ${rows[i].name}`, ...rows.slice(i + 1).map((row) => `${label} ${row.name}`));
      return;
    }
  }
}

async function txOutView(rpc: Rpc, point: SpentPoint, includeMempool: boolean): Promise<TxOutView> {
  try {
    return readTxOut(await rpc.call("gettxout", [point.txid, point.vout, includeMempool]));
  } catch {
    return "unusable";
  }
}

async function tipIsReady(rpc: Rpc): Promise<boolean> {
  try {
    return chainTipReady(await rpc.call("getblockchaininfo", []));
  } catch {
    return false;
  }
}

async function chainErrors(core: Ready[], knots: Ready[], knotsRpc: Rpc): Promise<string[]> {
  const errors: string[] = [];
  if (!(await tipIsReady(knotsRpc))) return ["Knots is still syncing."];
  const knotsPoints = new Map<string, number>();
  for (const row of knots) {
    if (row.inputs.length !== 1) {
      errors.push(`${row.name}: Knots file must spend one input`);
      continue;
    }
    const key = pointKey(row.inputs[0]);
    knotsPoints.set(key, (knotsPoints.get(key) ?? 0) + 1);
  }
  if ([...knotsPoints.values()].some((count) => count > 1)) {
    errors.push("More than one Knots file spends the same input.");
  }
  const corePoints = new Set<string>();
  for (const row of core) {
    for (const point of row.inputs) {
      const key = pointKey(point);
      if (corePoints.has(key)) errors.push(`${row.name}: duplicate Core input`);
      corePoints.add(key);
      const gone = outputGone(true, await txOutView(knotsRpc, point, true));
      if (gone === null) {
        errors.push(`${row.name}: Knots UTXO check failed`);
        continue;
      }
      const unspent = !gone;
      if (!row.wedge && unspent) {
        errors.push(`${row.name}: no OP_RETURN, and the input is still unspent on Knots`);
      }
      if (row.wedge && unspent && !knotsPoints.has(key)) {
        errors.push(`${row.name}: still unspent on Knots, and no Knots file spends it`);
      }
    }
  }
  for (const row of knots) {
    const key = row.inputs[0] ? pointKey(row.inputs[0]) : "";
    if (!corePoints.has(key)) errors.push(`${row.name}: Knots file spends an input that is not in the Core folder`);
  }
  return errors;
}

function transientRpc(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /disconnect|ECONN|ETIMEDOUT|EPIPE|socket|TLS|Tor could not|timed out|timeout|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|Unexpected token/i.test(
    message
  );
}

async function confirmedIds(rpc: Rpc, txids: string[], fromHeight: number, seen: Set<number>): Promise<Set<string>> {
  const want = new Set(txids);
  const found = new Set<string>();
  const tip = Number(await rpc.call("getblockcount", []));
  let scanned = 0;
  for (let height = fromHeight + 1; height <= tip; height += 1) {
    if (seen.has(height)) continue;
    const hash = String(await rpc.call("getblockhash", [height]));
    const block = (await rpc.call("getblock", [hash, 1])) as { tx?: string[] };
    for (const id of block.tx ?? []) {
      if (want.has(id)) found.add(id);
    }
    seen.add(height);
    scanned += 1;
    if (scanned % 24 === 0) console.log(`Core scan ${height}`);
  }
  return found;
}

async function stillInMempool(rpc: Rpc, txid: string): Promise<boolean | null> {
  try {
    await rpc.call("getmempoolentry", [txid]);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not in mempool|no such/i.test(message)) return false;
    return null;
  }
}

/** True when every input is already spent in a Core block. Null means the lookup failed. */
async function spentOnChain(rpc: Rpc, rows: Ready[]): Promise<boolean | null> {
  if (!(await tipIsReady(rpc))) return null;
  if (rows.length === 0) return false;
  for (const row of rows) {
    if (row.inputs.length === 0) return false;
    for (const point of row.inputs) {
      const gone = outputGone(true, await txOutView(rpc, point, false));
      if (gone !== true) return gone;
    }
  }
  return true;
}

async function waitForCoreConfirmations(
  rpc: Rpc,
  rows: Ready[],
  fromHeight: number,
  chainOnly = false
): Promise<string | null> {
  const txids = rows.map((row) => row.txid);
  const confirmed = new Set<string>();
  const seen = new Set<number>();
  const misses = new Map<string, number>();
  let deepened = false;
  for (;;) {
    try {
      for (const id of await confirmedIds(rpc, txids, fromHeight, seen)) confirmed.add(id);
      console.log(`Core confirmed ${confirmed.size} of ${txids.length}`);
      if (confirmed.size === txids.length) return null;
      if (chainOnly) {
        let conflict = false;
        for (const row of rows) {
          if (confirmed.has(row.txid)) continue;
          let allSpent = row.inputs.length > 0;
          for (const point of row.inputs) {
            const gone = outputGone(true, await txOutView(rpc, point, false));
            if (gone !== true) allSpent = false;
          }
          if (allSpent) conflict = true;
        }
        if (conflict) {
          if (!deepened) {
            deepened = true;
            fromHeight -= 2000;
            console.log("Core input looks spent. Scanning further back.");
            continue;
          }
          return "A Core input is spent in a block that does not contain the signed transaction. Knots was not sent.";
        }
      } else {
        let dropped = false;
        for (const id of txids) {
          if (confirmed.has(id)) continue;
          const mempool = await stillInMempool(rpc, id);
          if (mempool === true) misses.set(id, 0);
          if (mempool === false) {
            const count = (misses.get(id) ?? 0) + 1;
            misses.set(id, count);
            if (count >= 2) dropped = true;
          }
        }
        if (dropped) return "A Core transaction left the mempool without a confirmation. Knots was not sent.";
      }
      await new Promise((resolve) => setTimeout(resolve, 20_000));
    } catch (err) {
      if (!transientRpc(err)) throw err;
      console.error("Core connection dropped. Retrying.");
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  }
}

async function localConfirmRpc(): Promise<Rpc | null> {
  const path = join(homedir(), ".neop", "stack.json");
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      services?: { id?: string; endpoint?: string; cookieFile?: string; rpcUser?: string; rpcPassword?: string }[];
    };
    const core = parsed.services?.find((service) => service.id === "core-node");
    if (!core?.endpoint) return null;
    const rpc = await openRpc(
      {
        url: core.endpoint,
        cookieFile: core.cookieFile,
        user: core.rpcUser,
        password: core.rpcPassword,
      },
      "Core"
    );
    const info = (await rpc.call("getblockchaininfo", [])) as { initialblockdownload?: boolean };
    if (info.initialblockdownload) return null;
    console.log("Confirming Core on the local node.");
    return rpc;
  } catch {
    return null;
  }
}

async function checkOne(label: string, endpoint: Endpoint, socks?: string): Promise<boolean> {
  try {
    const rpc = await openRpc(endpoint, label, socks);
    const height = await rpc.call("getblockcount", []);
    console.log(`${label} RPC ok. Blocks: ${String(height)}`);
    return true;
  } catch (err) {
    console.error(`${label} RPC failed. ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function garnishDir(dir: string): string {
  const source = resolve(dir);
  const outDir = join(source, "garnished");
  mkdirSync(outDir, { recursive: true });
  const files = listFiles(source).filter((path) => path.toLowerCase().endsWith(".psbt"));
  const start = wedgeCycleStart();
  const failures = new Map<string, number>();
  let ok = 0;
  let minScript = Number.POSITIVE_INFINITY;
  let maxScript = 0;
  files.forEach((path, index) => {
    try {
      const result = garnishUnsignedPsbt(readFileSync(path), nextWedge(start + index));
      const base = path.split(/[/\\]/).pop() || "tx.psbt";
      writeFileSync(join(outDir, base), Buffer.from(result.psbtBase64, "base64"));
      ok += 1;
      minScript = Math.min(minScript, result.scriptPubKeyLength);
      maxScript = Math.max(maxScript, result.scriptPubKeyLength);
    } catch (err) {
      const message = err instanceof Error ? err.message : "could not garnish";
      const reason = /[0-9a-f]{16,}/i.test(message) ? "could not garnish" : message.split("\n")[0];
      failures.set(reason, (failures.get(reason) ?? 0) + 1);
    }
  });
  console.log(`Garnished: ${ok} of ${files.length}`);
  if (ok > 0) console.log(`OP_RETURN script length: ${minScript}-${maxScript} bytes`);
  for (const [reason, count] of failures) console.log(`Garnish failed (${count}): ${reason}`);
  return outDir;
}

async function preflightQuiet(dir: string) {
  const files = loadCoreFiles(resolve(dir));
  const counts = new Map<string, number>();
  const ready: Ready[] = [];
  for (const file of files) {
    if (file.status === "ready" && file.ready) ready.push(file.ready);
    const label =
      file.status === "ready"
        ? "passed"
        : file.status === "unsigned"
          ? "OP_RETURN present, not signed yet"
          : file.status === "partial"
            ? "OP_RETURN present, signatures incomplete"
            : file.detail || file.status;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  console.log(`Core PSBTs: ${files.length}`);
  for (const [label, count] of counts) console.log(`${count} ${label}`);
  if (ready.length === 0) {
    console.log("Mempool not checked. Nothing sent.");
    process.exit(1);
  }
  const configPath = flag("--config") || join(homedir(), ".neop", "broadcast.json");
  const config = loadConfig(configPath);
  const rpc = await openRpc(config.core, "Core", config.socks || "127.0.0.1:9150");
  if (!(await tipIsReady(rpc))) {
    console.error("Core is still syncing. Nothing sent.");
    process.exit(1);
  }
  const rejects = new Map<string, number>();
  let allowed = 0;
  for (const row of ready) {
    try {
      const verdict = readMempoolAccept(await rpc.call("testmempoolaccept", [[row.hex], 0]));
      if (verdict.allowed) allowed += 1;
      else {
        const reason = safeRejectReason(verdict.reason);
        rejects.set(reason, (rejects.get(reason) ?? 0) + 1);
      }
    } catch (err) {
      const reason = safeRejectReason(err instanceof Error ? err.message : "rejected");
      rejects.set(reason, (rejects.get(reason) ?? 0) + 1);
    }
  }
  console.log(`Core node would accept: ${allowed}`);
  for (const [reason, count] of rejects) console.log(`Core node rejected (${count}): ${reason}`);
  console.log("Nothing sent.");
  if (ready.length !== files.length || rejects.size > 0) process.exit(1);
}

async function checkRpc() {
  const configPath = flag("--config") || join(homedir(), ".neop", "broadcast.json");
  const config = loadConfig(configPath);
  const socks = config.socks || "127.0.0.1:9150";
  const coreOk = await checkOne("Core", config.core, socks);
  const knotsOk = await checkOne("Knots", config.knots);
  if (!coreOk || !knotsOk) process.exit(1);
}

async function main() {
  if (args.includes("--check")) {
    await checkRpc();
    return;
  }
  const coreDir = flag("--core-dir");
  if (args.includes("--garnish")) {
    if (!coreDir) {
      console.error("Usage: node scripts/broadcast-wave.mjs --garnish --core-dir PATH");
      process.exit(2);
    }
    const outDir = garnishDir(coreDir);
    await preflightQuiet(outDir);
    return;
  }
  if (args.includes("--preflight")) {
    if (!coreDir) {
      console.error("Usage: node scripts/broadcast-wave.mjs --preflight --core-dir PATH");
      process.exit(2);
    }
    await preflightQuiet(coreDir);
    return;
  }
  const knotsDir = flag("--knots-dir");
  if (!coreDir || !knotsDir) {
    console.error("Usage: node scripts/broadcast-wave.mjs --check");
    console.error("       node scripts/broadcast-wave.mjs --garnish --core-dir PATH");
    console.error("       node scripts/broadcast-wave.mjs --preflight --core-dir PATH");
    console.error("       node scripts/broadcast-wave.mjs --core-dir PATH --knots-dir PATH [--send | --send-knots] [--config PATH]");
    process.exit(2);
  }
  const core = loadDir(resolve(coreDir), "core");
  const knots = loadDir(resolve(knotsDir), "knots");
  const localErrors = [...core.errors, ...knots.errors];
  for (const error of localErrors) console.error(safeRejectReason(error));
  if (localErrors.length) {
    console.error(args.includes("--send-knots") ? "Knots not sent." : "Nothing sent.");
    process.exit(1);
  }
  console.log(`Core files ${core.ready.length} (${core.ready.filter((row) => row.wedge).length} with OP_RETURN)`);
  console.log(`Knots files ${knots.ready.length}`);

  const configPath = flag("--config") || join(homedir(), ".neop", "broadcast.json");
  const config = loadConfig(configPath);
  const socks = config.socks || "127.0.0.1:9150";
  const sendKnots = args.includes("--send-knots");
  const coreRpc = await openRpc(config.core, "Core", socks);
  const knotsRpc = await openRpc(config.knots, "Knots");
  const localCore = sendKnots ? await localConfirmRpc() : null;
  const proofRpc = sendKnots && localCore ? localCore : coreRpc;
  let coreReady = false;
  let knotsReady = false;
  try {
    coreReady = chainTipReady(await proofRpc.call("getblockchaininfo", []));
    knotsReady = chainTipReady(await knotsRpc.call("getblockchaininfo", []));
    const coreGenesis = await proofRpc.call("getblockhash", [0]);
    const knotsGenesis = await knotsRpc.call("getblockhash", [0]);
    if (!sameNetwork(coreGenesis, knotsGenesis)) {
      console.error(sendKnots ? "Core and Knots are not the same network. Knots not sent." : "Core and Knots are not the same network. Nothing sent.");
      process.exit(1);
    }
  } catch (err) {
    console.error(safeRejectReason(err instanceof Error ? err.message : String(err)));
    console.error(sendKnots ? "Knots not sent." : "Nothing sent.");
    process.exit(1);
  }
  if (!knotsReady) {
    console.error(sendKnots ? "Knots is still syncing. Knots not sent." : "Knots is still syncing. Nothing sent.");
    process.exit(1);
  }
  if (!coreReady) {
    console.error(sendKnots ? "Core is still syncing. Knots not sent." : "Core is still syncing. Nothing sent.");
    process.exit(1);
  }
  const presenceErrors = await chainErrors(core.ready, knots.ready, knotsRpc);
  for (const error of presenceErrors) console.error(error);
  if (presenceErrors.length) {
    console.error(sendKnots ? "Knots not sent." : "Nothing sent.");
    process.exit(1);
  }
  if (sendKnots) {
    const knotsPre = await preflight(knotsRpc, knots.ready, "knots");
    const knotsGate = mayBroadcast([], knotsPre.verdicts);
    if (!knotsGate.ok) {
      for (const error of knotsPre.errors) console.error(safeRejectReason(error));
      console.error(`Knots not sent. ${safeRejectReason(knotsGate.reason)}`);
      process.exit(1);
    }
    const confirmRpc = localCore ?? coreRpc;
    const spent = await spentOnChain(confirmRpc, knots.ready);
    if (spent === null) {
      console.error("Core UTXO check failed. Knots not sent.");
      process.exit(1);
    }
    if (!spent) {
      console.error("A Knots input is still unspent on Core. Knots not sent.");
      process.exit(1);
    }
    console.log("Core inputs for the Knots batch are spent.");
    const again = await preflight(knotsRpc, knots.ready, "knots");
    const againGate = mayBroadcast([], again.verdicts);
    if (!againGate.ok) {
      for (const error of again.errors) console.error(safeRejectReason(error));
      console.error(`Core is confirmed. Knots not sent. ${safeRejectReason(againGate.reason)}`);
      process.exit(1);
    }
    const spentAgain = await spentOnChain(confirmRpc, knots.ready);
    if (spentAgain !== true) {
      console.error(spentAgain === null ? "Core UTXO check failed. Knots not sent." : "A Knots input is still unspent on Core. Knots not sent.");
      process.exit(1);
    }
    const state = { stop: false };
    const knotsSent: string[] = [];
    const knotsHeld: string[] = [];
    await sendChain(knotsRpc, knots.ready, "knots", state, knotsSent, knotsHeld);
    if (knotsHeld.length || state.stop) {
      console.error("Knots accepted:");
      for (const line of knotsSent) console.error(line);
      console.error("Knots not sent:");
      for (const line of knotsHeld) console.error(line);
      process.exit(1);
    }
    console.log("Knots sent.");
    return;
  }
  const corePre = await preflight(coreRpc, core.ready, "core");
  const knotsPre = await preflight(knotsRpc, knots.ready, "knots");
  const gate = mayBroadcast([], [...corePre.verdicts, ...knotsPre.verdicts]);
  if (!gate.ok) {
    for (const error of [...corePre.errors, ...knotsPre.errors]) console.error(safeRejectReason(error));
    console.error(`Nothing sent. ${safeRejectReason(gate.reason)}`);
    process.exit(1);
  }
  if (!args.includes("--send")) {
    console.log("Preflight allowed. Nothing sent.");
    return;
  }

  const startHeight = Number(await coreRpc.call("getblockcount", []));
  const state = { stop: false };
  const sent: string[] = [];
  const notSent: string[] = [];
  await sendChain(coreRpc, core.ready, "core", state, sent, notSent);
  if (notSent.length || state.stop) {
    console.error("Core accepted:");
    for (const line of sent) console.error(line);
    console.error("Core not sent:");
    for (const line of notSent) console.error(line);
    console.error("Knots not sent.");
    process.exit(1);
  }
  const stalled = await waitForCoreConfirmations(coreRpc, core.ready, startHeight);
  if (stalled) {
    console.error(stalled);
    process.exit(1);
  }
  const knotsAgain = await preflight(knotsRpc, knots.ready, "knots");
  const knotsGate = mayBroadcast([], knotsAgain.verdicts);
  if (!knotsGate.ok) {
    for (const error of knotsAgain.errors) console.error(safeRejectReason(error));
    console.error(`Core is confirmed. Knots not sent. ${safeRejectReason(knotsGate.reason)}`);
    process.exit(1);
  }
  const spentNow = await spentOnChain(coreRpc, knots.ready);
  if (spentNow !== true) {
    console.error(spentNow === null ? "Core UTXO check failed. Knots not sent." : "A Knots input is still unspent on Core. Knots not sent.");
    process.exit(1);
  }
  state.stop = false;
  const knotsSent: string[] = [];
  const knotsHeld: string[] = [];
  await sendChain(knotsRpc, knots.ready, "knots", state, knotsSent, knotsHeld);
  if (knotsHeld.length || state.stop) {
    console.error("Knots accepted:");
    for (const line of knotsSent) console.error(line);
    console.error("Knots not sent:");
    for (const line of knotsHeld) console.error(line);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(safeRejectReason(err instanceof Error ? err.message : String(err)));
  console.error(broadcastAbortFooter(args.includes("--send-knots"), coreAlreadySent, knotsAlreadySent));
  process.exit(1);
});
