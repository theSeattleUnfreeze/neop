import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachUnsigned, classifyUnsigned, garnishTargets, rowReady } from "./queue.ts";

const listed = new Set(["aa:0"]);

describe("unsigned queue", () => {
  it("marks the matching row and leaves a wrong coin or a signed file unmatched", () => {
    assert.deepEqual(
      classifyUnsigned({ name: "a.psbt", inputCount: 1, outpoints: ["aa:0"], signed: false }, listed),
      { ok: true, outpoint: "aa:0" }
    );
    assert.equal(
      classifyUnsigned({ name: "b.psbt", inputCount: 1, outpoints: ["cc:1"], signed: false }, listed).ok,
      false
    );
    assert.equal(
      classifyUnsigned({ name: "c.psbt", inputCount: 1, outpoints: ["aa:0"], signed: true }, listed).ok,
      false
    );
  });

  it("does not need a label to become ready", () => {
    const first = attachUnsigned("core-garnish", {}, "aa:0", { name: "a.psbt" });
    assert.equal(rowReady("core-garnish", first.slots["aa:0"].length), true);
    const replaced = attachUnsigned("core-garnish", first.slots, "aa:0", { name: "b.psbt" });
    assert.deepEqual(replaced.slots["aa:0"].map((file) => file.name), ["b.psbt"]);
  });

  it("is ready for a drain only after two files, and garnishes the marked one", () => {
    const one = attachUnsigned("drain", {}, "aa:0", { name: "core.psbt" });
    assert.equal(rowReady("drain", one.slots["aa:0"].length), false);
    const two = attachUnsigned("drain", one.slots, "aa:0", { name: "knots.psbt" });
    assert.equal(rowReady("drain", two.slots["aa:0"].length), true);
    assert.deepEqual(garnishTargets("drain", two.slots["aa:0"], "core.psbt"), { ok: true, names: ["core.psbt"] });
    assert.equal(garnishTargets("drain", two.slots["aa:0"], null).ok, false);
    const third = attachUnsigned("drain", two.slots, "aa:0", { name: "extra.psbt" });
    assert.equal(third.reason !== null, true);
  });
});
