import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  annotate,
  filterByFlavor,
  isCoreBoundSuccess,
  isSpill,
  presenceOf,
  type CoinRow,
  type TipView,
} from "./presence";

describe("presenceOf", () => {
  it("labels core_only, knots_only, both, and none", () => {
    assert.equal(presenceOf({ status: "unspent" }, { status: "absent" }), "core_only");
    assert.equal(presenceOf({ status: "absent" }, { status: "unspent" }), "knots_only");
    assert.equal(presenceOf({ status: "spent" }, { status: "unspent" }), "both");
    assert.equal(presenceOf({ status: "absent" }, { status: "absent" }), "none");
  });
});

describe("isCoreBoundSuccess", () => {
  it("detects Core-bound ceremony pattern", () => {
    assert.equal(isCoreBoundSuccess({ status: "spent" }, { status: "unspent" }), true);
    assert.equal(isCoreBoundSuccess({ status: "spent" }, { status: "spent" }), false);
    assert.equal(isCoreBoundSuccess({ status: "unspent" }, { status: "unspent" }), false);
  });
});

describe("isSpill", () => {
  it("returns false unless both tips are spent", () => {
    assert.equal(isSpill({ status: "spent" }, { status: "unspent" }), false);
    assert.equal(isSpill({ status: "unspent" }, { status: "spent" }), false);
  });

  it("returns true when both spent with matching outpoints", () => {
    const outpoint: TipView = { status: "spent", txid: "aa", vout: 0 };
    assert.equal(isSpill(outpoint, { ...outpoint }), true);
  });

  it("returns false when both spent with different outpoints", () => {
    assert.equal(
      isSpill({ status: "spent", txid: "aa", vout: 0 }, { status: "spent", txid: "bb", vout: 1 }),
      false
    );
  });

  it("flags incomplete outpoint metadata for manual review", () => {
    assert.equal(isSpill({ status: "spent", txid: "aa" }, { status: "spent" }), true);
    assert.equal(isSpill({ status: "spent" }, { status: "spent", txid: "bb", vout: 0 }), true);
  });
});

describe("filterByFlavor", () => {
  const row: CoinRow = {
    scriptId: 1,
    core: { status: "unspent" },
    knots: { status: "absent" },
  };

  it("includes rows present on the selected tip", () => {
    assert.equal(filterByFlavor(row, "core"), true);
    assert.equal(filterByFlavor(row, "knots"), false);
  });
});

describe("annotate", () => {
  it("adds presence, coreBoundOk, and spill fields", () => {
    const row: CoinRow = {
      scriptId: 42,
      core: { status: "spent", txid: "x", vout: 0 },
      knots: { status: "unspent" },
    };
    const out = annotate(row);
    assert.equal(out.scriptId, 42);
    assert.equal(out.presence, "both");
    assert.equal(out.coreBoundOk, true);
    assert.equal(out.spill, false);
  });
});
