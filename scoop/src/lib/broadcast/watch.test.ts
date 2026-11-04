import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blockGapOdds, feeRateSatPerVbyte, freshIds, reorgedHeights, rowStatus } from "./watch.ts";

describe("batch watch", () => {
  it("puts a 46 minute block gap at about one percent", () => {
    const odds = blockGapOdds(46);
    assert.ok(Math.abs(odds - Math.exp(-4.6)) < 1e-12);
    assert.ok(odds > 0.01 && odds < 0.0101);
  });

  it("names heights whose block hash moved", () => {
    assert.deepEqual(
      reorgedHeights(
        [
          { height: 10, hash: "aa" },
          { height: 11, hash: "bb" },
        ],
        [
          { height: 10, hash: "aa" },
          { height: 11, hash: "cc" },
        ]
      ),
      [11]
    );
  });

  it("ranks reorg above a foreign spend, and a foreign spend above mempool", () => {
    const base = { ourTxid: "ours", spenders: ["ours"] as (string | null)[], hashAtConfirmedHeight: "aa" };
    assert.equal(rowStatus({ ...base, inMempool: true, confirmed: null, hashAtConfirmedHeight: null }), "mempool");
    assert.equal(
      rowStatus({ ...base, inMempool: true, spenders: ["theirs"], confirmed: null, hashAtConfirmedHeight: null }),
      "conflict"
    );
    assert.equal(
      rowStatus({ ...base, inMempool: false, confirmed: { height: 5, hash: "aa" }, hashAtConfirmedHeight: "aa" }),
      "confirmed"
    );
    assert.equal(
      rowStatus({ ...base, inMempool: true, confirmed: { height: 5, hash: "aa" }, hashAtConfirmedHeight: "zz" }),
      "reorged"
    );
    assert.equal(rowStatus({ ...base, inMempool: false, confirmed: null, hashAtConfirmedHeight: null, spenders: [null] }), "missing");
  });

  it("reports a fee rate and newly mined ids", () => {
    assert.equal(feeRateSatPerVbyte(2000, 100), 20);
    assert.equal(feeRateSatPerVbyte(1, 0), null);
    assert.deepEqual(freshIds(new Set(["a"]), new Set(["a", "b"])), ["b"]);
  });
});
