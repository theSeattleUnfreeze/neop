import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rdtsWarning } from "../broadcast/pairWave.ts";
import type { SignedFile } from "../broadcast/pairWave.ts";
import {
  chainLane,
  coversQueue,
  expectedWave,
  nextWaveForMethod,
  pairWaveForMethod,
  rdtsApplies,
} from "./method.ts";

const core = (why = "long-op-return"): SignedFile => ({
  name: "core.psbt",
  flavor: "core",
  why,
  inputCount: 1,
  outpoints: ["aa:0"],
});

const knots = (why = "sighash-all"): SignedFile => ({
  name: "knots.psbt",
  flavor: "knots",
  why,
  inputCount: 1,
  outpoints: ["aa:0"],
});

const unified = (): SignedFile => ({
  name: "unified.psbt",
  flavor: "knots",
  why: "unified-sighash",
  inputCount: 1,
  outpoints: ["aa:0"],
});

describe("split methods", () => {
  it("expects one side or both", () => {
    assert.deepEqual(expectedWave("core-garnish", "needs-split"), { core: 1, knots: 0 });
    assert.deepEqual(expectedWave("unified-sighash", "needs-split"), { core: 0, knots: 1 });
    assert.deepEqual(expectedWave("drain", "needs-split"), { core: 1, knots: 1 });
  });

  it("accepts a Core-only wave for Core garnish and rejects it for drain", () => {
    const catalog = { "aa:0": "needs-split" as const };
    assert.equal(pairWaveForMethod([core()], catalog, "core-garnish").ok, true);
    assert.equal(pairWaveForMethod([core()], catalog, "drain").ok, false);
    assert.equal(pairWaveForMethod([knots()], catalog, "core-garnish").ok, false);
    assert.equal(pairWaveForMethod([core("sighash-all")], catalog, "core-garnish").ok, false);
  });

  it("accepts a unified wave for unified sighash and rejects it for drain", () => {
    const catalog = { "aa:0": "needs-split" as const };
    assert.equal(pairWaveForMethod([unified()], catalog, "unified-sighash").ok, true);
    assert.equal(pairWaveForMethod([unified()], catalog, "drain").ok, false);
    assert.equal(pairWaveForMethod([knots()], catalog, "unified-sighash").ok, false);
    assert.equal(pairWaveForMethod([core()], catalog, "unified-sighash").ok, false);
  });

  it("still requires one of each for a drain", () => {
    const catalog = { "aa:0": "needs-split" as const };
    assert.equal(pairWaveForMethod([core(), knots()], catalog, "drain").ok, true);
    assert.equal(pairWaveForMethod([core()], catalog, "drain").ok, false);
  });

  it("requires every listed coin and no extras", () => {
    const missing = coversQueue("core-garnish", ["aa:0", "bb:1"], [core()]);
    assert.equal(missing.ok, false);
    const extra = coversQueue("core-garnish", ["bb:1"], [core()]);
    assert.equal(extra.ok, false);
    assert.equal(coversQueue("core-garnish", ["aa:0"], [core()]).ok, true);
  });

  it("does not send Knots after Core garnish, and does not wait for unified sighash", () => {
    const hold = nextWaveForMethod("core-garnish", { coreFileCount: 1, coreInputsSpent: true, knotsSent: false });
    assert.equal(hold.phase, "done");
    const send = nextWaveForMethod("unified-sighash", { coreFileCount: 0, coreInputsSpent: null, knotsSent: false });
    assert.equal(send.phase, "send-knots");
    const drain = nextWaveForMethod("drain", { coreFileCount: 1, coreInputsSpent: false, knotsSent: false });
    assert.equal(drain.phase, "hold");
  });

  it("marks which chain stays", () => {
    assert.equal(chainLane("core-garnish", "knots"), "staying");
    assert.equal(chainLane("unified-sighash", "core"), "staying");
    assert.equal(chainLane("drain", "core"), "moving");
  });

  it("uses the shared reduced-data warning instead of a second clock", () => {
    assert.equal(rdtsApplies("core-garnish"), true);
    assert.equal(rdtsApplies("drain"), true);
    assert.equal(rdtsApplies("unified-sighash"), false);
    assert.equal(typeof rdtsWarning, "function");
  });
});
