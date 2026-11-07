import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Transaction } from "bitcoinjs-lib";
import {
  MAX_GAP_MS,
  coreProblems,
  jitterMs,
  knotsAfterCoreProblems,
  knotsProblems,
  phaseProblems,
  broadcastAbortFooter,
  chainTipReady,
  httpHost,
  mayBroadcast,
  outputGone,
  readMempoolAccept,
  readTxOut,
  sameNetwork,
  tlsRejectUnauthorized,
  tlsServerName,
} from "./wave.ts";

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

function tx(sighash: number, outputs: Buffer[]): Transaction {
  const raw = new Transaction();
  raw.addInput(Buffer.alloc(32, 1), 0);
  raw.setWitness(0, [derSig(sighash)]);
  for (const script of outputs) raw.addOutput(script, script[0] === 0x6a ? 0 : 50_000);
  return raw;
}

describe("broadcast wave", () => {
  it("accepts a one-input Core garnish and rejects it as Knots", () => {
    const raw = tx(0x01, [payScript(), wedge()]);
    assert.deepEqual(coreProblems(raw), []);
    assert.ok(knotsProblems(raw).some((problem) => problem.includes("OP_RETURN")));
  });

  it("accepts a one-input unified-sighash Knots transaction and rejects it as Core", () => {
    const raw = tx(0x21, [payScript()]);
    assert.deepEqual(knotsProblems(raw), []);
    assert.ok(coreProblems(raw).some((problem) => problem.includes("unified sighash")));
  });

  it("rejects a Core transaction with no OP_RETURN until Knots no longer has the input", () => {
    const raw = tx(0x01, [payScript()]);
    assert.ok(coreProblems(raw).some((problem) => problem.includes("OP_RETURN")));
    assert.deepEqual(coreProblems(raw, { knotsAbsent: true }), []);
    raw.addInput(Buffer.alloc(32, 2), 1);
    raw.setWitness(1, [derSig(0x01)]);
    assert.deepEqual(coreProblems(raw, { knotsAbsent: true }), []);
  });

  it("accepts a SIGHASH_ALL Knots transaction only on the after-Core path", () => {
    const raw = tx(0x01, [payScript()]);
    assert.deepEqual(knotsAfterCoreProblems(raw), []);
    assert.ok(knotsProblems(raw).some((problem) => problem.includes("UNIFIED")));
  });

  it("checks a file against the chain it was assigned to", () => {
    const garnish = tx(0x01, [payScript(), wedge()]);
    const after = tx(0x01, [payScript()]);
    const unified = tx(0x21, [payScript()]);
    assert.deepEqual(phaseProblems(garnish, "core", "long-op-return"), []);
    assert.deepEqual(phaseProblems(after, "core", "knots-absent"), []);
    assert.ok(phaseProblems(after, "core", "long-op-return").length > 0);
    assert.deepEqual(phaseProblems(after, "knots", "sighash-all"), []);
    assert.deepEqual(phaseProblems(unified, "knots", "unified-sighash"), []);
    assert.ok(phaseProblems(garnish, "knots", "sighash-all").some((problem) => problem.includes("OP_RETURN")));
  });

  it("refuses more than one input", () => {
    const raw = tx(0x01, [payScript(), wedge()]);
    raw.addInput(Buffer.alloc(32, 2), 1);
    assert.ok(coreProblems(raw).some((problem) => problem.includes("2 inputs")));
  });

  it("keeps the gap inside 0 to 2000 ms", () => {
    assert.equal(jitterMs(0), 0);
    assert.equal(jitterMs(0.999999), MAX_GAP_MS);
    assert.ok(jitterMs(0.5) <= MAX_GAP_MS);
    assert.throws(() => jitterMs(1), /unit interval/);
  });

  it("reads one testmempoolaccept row", () => {
    assert.deepEqual(readMempoolAccept([{ allowed: true }]), { allowed: true, reason: undefined });
    assert.equal(readMempoolAccept([{ allowed: false, "reject-reason": "datacarrier" }]).reason, "datacarrier");
  });

  it("sends only when every preflight allowed", () => {
    assert.equal(mayBroadcast([], [{ allowed: true }, { allowed: true }]).ok, true);
    const local = mayBroadcast(["Core transaction has no signature."], [{ allowed: true }]);
    assert.equal(local.ok, false);
    const policy = mayBroadcast([], [{ allowed: true }, { allowed: false, reason: "datacarrier" }]);
    assert.equal(policy.ok, false);
    if (!policy.ok) assert.equal(policy.reason, "datacarrier");
    assert.equal(mayBroadcast([], []).ok, false);
  });

  it("names the abort footer after Core send or --send-knots", () => {
    assert.equal(broadcastAbortFooter(false, false), "Nothing sent.");
    assert.equal(broadcastAbortFooter(false, true), "Knots not sent.");
    assert.equal(broadcastAbortFooter(true, false), "Knots not sent.");
    assert.equal(broadcastAbortFooter(true, true), "Knots not sent.");
    assert.equal(broadcastAbortFooter(true, false, true), "Knots broadcast already started.");
    assert.equal(broadcastAbortFooter(false, true, true), "Knots broadcast already started.");
  });

  it("treats gettxout null as spent only on a finished tip", () => {
    assert.equal(readTxOut(null), "absent");
    assert.equal(readTxOut({ bestblock: "aa" }), "present");
    assert.equal(readTxOut(undefined), "unusable");
    assert.equal(readTxOut("missing"), "unusable");
    assert.equal(chainTipReady({ initialblockdownload: false, blocks: 100 }), true);
    assert.equal(chainTipReady({ initialblockdownload: true, blocks: 100 }), false);
    assert.equal(chainTipReady({ initialblockdownload: false, blocks: 0 }), false);
    assert.equal(chainTipReady({ blocks: 100 }), false);
    assert.equal(outputGone(true, "absent"), true);
    assert.equal(outputGone(true, "present"), false);
    assert.equal(outputGone(false, "absent"), null);
    assert.equal(outputGone(true, "unusable"), null);
    assert.equal(outputGone(false, "present"), false);
  });

  it("requires one network and a TLS name only for a hostname", () => {
    const genesis = "ab".repeat(32);
    assert.equal(sameNetwork(genesis, genesis.toUpperCase()), true);
    assert.equal(sameNetwork(genesis, "cd".repeat(32)), false);
    assert.equal(sameNetwork("zz", "zz"), false);
    assert.equal(httpHost("::1", "57747", 6), "[::1]:57747");
    assert.equal(httpHost("10.0.0.2", "8332", 4), "10.0.0.2:8332");
    assert.equal(tlsServerName("10.0.0.2", 4), undefined);
    assert.equal(tlsServerName("::1", 6), undefined);
    assert.equal(tlsServerName("LAN-KNOTS", 0), "LAN-KNOTS");
    assert.equal(tlsRejectUnauthorized(undefined), true);
    assert.equal(tlsRejectUnauthorized(true), false);
    assert.equal(tlsRejectUnauthorized(false), true);
  });
});
