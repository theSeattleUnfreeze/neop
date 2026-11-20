import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttp, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttps } from "node:https";
import { connect as netConnect, createServer as createNet, type Server } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { Transaction } from "bitcoinjs-lib";

const repo = path.resolve(import.meta.dirname, "../../../..");
const script = path.join(repo, "scripts", "broadcast-wave.ts");
const GENESIS = "11".repeat(32);

type Call = { role: "core" | "knots"; method: string; params: unknown[] };

function derSig(sighash: number): Buffer {
  const sig = Buffer.from("300602010102010101", "hex");
  sig[sig.length - 1] = sighash;
  return sig;
}

function payScript(): Buffer {
  return Buffer.from("0014" + "22".repeat(20), "hex");
}

function wedge(): Buffer {
  const data = Buffer.alloc(85, 7);
  return Buffer.concat([Buffer.from([0x6a, 0x4c, data.length]), data]);
}

function coin(sighash: number, outputs: Buffer[], input = Buffer.alloc(32, 1)): Transaction {
  const raw = new Transaction();
  raw.addInput(input, 0);
  raw.setWitness(0, [derSig(sighash)]);
  for (const script of outputs) raw.addOutput(script, script[0] === 0x6a ? 0 : 50_000);
  return raw;
}

type Mode = {
  ibd?: boolean;
  reject?: boolean;
  abortHex?: boolean;
  coreTxout?: "present" | "absent";
  knotsTxout?: "present" | "absent";
};

function answer(mode: Mode, role: "core" | "knots", method: string, params: unknown[], seen: Set<string>) {
  if (mode.abortHex && method === "getblockchaininfo") {
    return { result: null, error: { message: `node said ${"cd".repeat(32)}` } };
  }
  if (method === "getblockchaininfo") {
    return {
      result: { initialblockdownload: mode.ibd === true, blocks: mode.ibd ? 0 : 10 },
      error: null,
    };
  }
  if (method === "getblockhash") return { result: GENESIS, error: null };
  if (method === "getblockcount") return { result: seen.size ? 11 : 10, error: null };
  if (method === "getblock") return { result: { tx: [...seen] }, error: null };
  if (method === "testmempoolaccept") {
    const hex = Array.isArray(params[0]) ? params[0][0] : undefined;
    if (typeof hex === "string") {
      try {
        seen.add(Transaction.fromHex(hex).getId());
      } catch {
        /* the script still records the call */
      }
    }
    if (mode.reject) return { result: [{ allowed: false, "reject-reason": "too-long-mempool-chain" }], error: null };
    return { result: [{ allowed: true }], error: null };
  }
  if (method === "sendrawtransaction") {
    if (typeof params[0] === "string") {
      try {
        seen.add(Transaction.fromHex(params[0]).getId());
      } catch {
        /* recorded above */
      }
    }
    return { result: true, error: null };
  }
  if (method === "gettxout") {
    const which = role === "core" ? mode.coreTxout : mode.knotsTxout;
    return { result: which === "absent" ? null : { confirmations: 1 }, error: null };
  }
  if (method === "getmempoolentry") return { result: null, error: { message: "Transaction not in mempool" } };
  return { result: null, error: { message: "unknown method" } };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}

function startSocks(): Promise<{ port: number; targets: string[]; close: () => Promise<void> }> {
  const targets: string[] = [];
  const server = createNet((socket) => {
    let stage = 0;
    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 0) {
        if (buf.length < 3) return;
        socket.write(Buffer.from([0x05, 0x00]));
        buf = Buffer.alloc(0);
        stage = 1;
        return;
      }
      if (buf.length < 5) return;
      const atyp = buf[3];
      let host = "";
      let port = 0;
      let used = 0;
      if (atyp === 0x03) {
        const len = buf[4];
        if (buf.length < 7 + len) return;
        host = buf.subarray(5, 5 + len).toString();
        port = buf.readUInt16BE(5 + len);
        used = 7 + len;
      } else if (atyp === 0x01) {
        if (buf.length < 10) return;
        host = Array.from(buf.subarray(4, 8)).join(".");
        port = buf.readUInt16BE(8);
        used = 10;
      } else {
        socket.destroy();
        return;
      }
      targets.push(`${host}:${port}`);
      const rest = buf.subarray(used);
      socket.off("data", onData);
      socket.pause();
      socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
      const upstream = netConnect(port, host, () => {
        if (rest.length) upstream.write(rest);
        socket.pipe(upstream);
        upstream.pipe(socket);
        socket.resume();
      });
      upstream.on("error", () => socket.destroy());
    };
    socket.on("data", onData);
    socket.on("error", () => undefined);
  });
  return listen(server).then((port) => ({
    port,
    targets,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }));
}

function certs(dir: string): { key: Buffer; cert: Buffer } {
  const key = path.join(dir, "key.pem");
  const cert = path.join(dir, "cert.pem");
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-keyout", key, "-out", cert, "-days", "1", "-nodes", "-subj", "/CN=127.0.0.1"],
    { stdio: "pipe" }
  );
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

async function startNode(
  role: "core" | "knots",
  mode: Mode,
  seen: Set<string>,
  calls: Call[],
  tls?: { key: Buffer; cert: Buffer; names: Array<string | false | undefined> }
): Promise<{ port: number; close: () => Promise<void> }> {
  const onReq = (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      let method = "";
      let params: unknown[] = [];
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method?: string; params?: unknown[] };
        method = body.method ?? "";
        params = body.params ?? [];
      } catch {
        method = "";
      }
      calls.push({ role, method, params });
      const payload = JSON.stringify(answer(mode, role, method, params, seen));
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        connection: "close",
      });
      res.end(payload);
    });
  };
  const server = tls
    ? createHttps({ key: tls.key, cert: tls.cert }, onReq)
    : createHttp(onReq);
  if (tls) {
    server.on("secureConnection", (socket: { servername?: string | false }) => {
      tls.names.push(socket.servername);
    });
  }
  const port = await listen(server);
  return { port, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

function runScript(args: string[], home: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "tsx", script, ...args], {
      cwd: path.join(repo, "scoop"),
      shell: true,
      env: { ...process.env, USERPROFILE: home, HOME: home, HOMEPATH: home },
    });
    const chunks: Buffer[] = [];
    child.stdout?.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("broadcast script timed out"));
    }, 20_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output: Buffer.concat(chunks).toString("utf8") });
    });
  });
}

function assertNoLongHex(output: string) {
  assert.equal(/[0-9a-fA-F]{64}/.test(output), false);
}

async function withMock(
  mode: Mode,
  body: (ctx: {
    calls: Call[];
    home: string;
    names: Array<string | false | undefined>;
    targets: string[];
    corePort: number;
    knotsPort: number;
  }) => Promise<void>
) {
  const home = mkdtempSync(path.join(tmpdir(), "wave-"));
  const calls: Call[] = [];
  const seen = new Set<string>();
  const names: Array<string | false | undefined> = [];
  const material = certs(home);
  const socks = await startSocks();
  const core = await startNode("core", mode, seen, calls);
  const knots = await startNode("knots", mode, seen, calls, { ...material, names });
  const config = {
    socks: `127.0.0.1:${socks.port}`,
    core: { url: `http://127.0.0.1:${core.port}`, user: "op", password: "op" },
    knots: { url: `https://127.0.0.1:${knots.port}`, user: "op", password: "op", tlsInsecure: true },
  };
  writeFileSync(path.join(home, "broadcast.json"), JSON.stringify(config));
  try {
    await body({ calls, home, names, targets: socks.targets, corePort: core.port, knotsPort: knots.port });
  } finally {
    await core.close();
    await knots.close();
    await socks.close();
    rmSync(home, { recursive: true, force: true });
  }
}

function dirs(home: string, coreHex: string, knotsHex: string) {
  const coreDir = path.join(home, "core");
  const knotsDir = path.join(home, "knots");
  mkdirSync(coreDir);
  mkdirSync(knotsDir);
  writeFileSync(path.join(coreDir, "coin.psbt"), coreHex);
  writeFileSync(path.join(knotsDir, "coin.psbt"), knotsHex);
  return { coreDir, knotsDir };
}

describe("broadcast wave script", () => {
  const input = Buffer.alloc(32, 1);
  const coreHex = coin(0x01, [payScript(), wedge()], input).toHex();
  const knotsHex = coin(0x21, [payScript()], input).toHex();
  const plainHex = coin(0x01, [payScript()], input).toHex();

  it("sends Knots only after Core is spent, through SOCKS for Core and without TLS servername", async () => {
    await withMock({ coreTxout: "absent", knotsTxout: "present" }, async ({ calls, home, names, targets, corePort, knotsPort }) => {
      const { coreDir, knotsDir } = dirs(home, coreHex, knotsHex);
      const result = await runScript(
        ["--config", path.join(home, "broadcast.json"), "--core-dir", coreDir, "--knots-dir", knotsDir, "--send-knots"],
        home
      );
      assertNoLongHex(result.output);
      assert.equal(result.code, 0);
      assert.equal(calls.some((call) => call.role === "core" && call.method === "sendrawtransaction"), false);
      const sent = calls.filter((call) => call.method === "sendrawtransaction" || call.method === "testmempoolaccept");
      assert.ok(sent.length > 0);
      for (const call of sent) assert.equal(call.params[call.params.length - 1], 0);
      assert.ok(targets.length > 0);
      assert.ok(targets.every((target) => target === `127.0.0.1:${corePort}`));
      assert.equal(targets.some((target) => target.endsWith(`:${knotsPort}`)), false);
      assert.ok(names.length > 0);
      // Node reports a missing SNI extension as false, not as a hostname.
      assert.ok(names.every((name) => name === false || name === "" || name == null));
    });
  });

  it("does not send when one preflight is rejected", async () => {
    await withMock({ reject: true, coreTxout: "absent", knotsTxout: "present" }, async ({ calls, home }) => {
      const { coreDir, knotsDir } = dirs(home, coreHex, knotsHex);
      const result = await runScript(
        ["--config", path.join(home, "broadcast.json"), "--core-dir", coreDir, "--knots-dir", knotsDir, "--send"],
        home
      );
      assertNoLongHex(result.output);
      assert.notEqual(result.code, 0);
      assert.equal(calls.some((call) => call.method === "sendrawtransaction"), false);
      assert.ok(calls.some((call) => call.method === "testmempoolaccept" && call.params[1] === 0));
    });
  });

  it("refuses Knots and a Core file without a long OP_RETURN while the node is downloading", async () => {
    await withMock({ ibd: true, coreTxout: "absent", knotsTxout: "absent" }, async ({ calls, home }) => {
      const wave = dirs(home, coreHex, knotsHex);
      const knotsOnly = await runScript(
        ["--config", path.join(home, "broadcast.json"), "--core-dir", wave.coreDir, "--knots-dir", wave.knotsDir, "--send-knots"],
        home
      );
      assertNoLongHex(knotsOnly.output);
      assert.match(knotsOnly.output, /still syncing/);
      assert.notEqual(knotsOnly.code, 0);
      const plainDir = path.join(home, "plain");
      const knotsDir = path.join(home, "plain-knots");
      mkdirSync(plainDir);
      mkdirSync(knotsDir);
      writeFileSync(path.join(plainDir, "coin.psbt"), plainHex);
      writeFileSync(path.join(knotsDir, "coin.psbt"), knotsHex);
      const plain = await runScript(
        ["--config", path.join(home, "broadcast.json"), "--core-dir", plainDir, "--knots-dir", knotsDir, "--send"],
        home
      );
      assertNoLongHex(plain.output);
      assert.match(plain.output, /still syncing/);
      assert.notEqual(plain.code, 0);
      assert.equal(calls.some((call) => call.method === "sendrawtransaction"), false);
    });
  });

  it("strips a long hex id from an unexpected abort", async () => {
    await withMock({ abortHex: true, coreTxout: "absent", knotsTxout: "present" }, async ({ home }) => {
      const { coreDir, knotsDir } = dirs(home, coreHex, knotsHex);
      const result = await runScript(
        ["--config", path.join(home, "broadcast.json"), "--core-dir", coreDir, "--knots-dir", knotsDir, "--send-knots"],
        home
      );
      assert.notEqual(result.code, 0);
      assert.match(result.output, /node said/);
      assertNoLongHex(result.output);
    });
  });
});
