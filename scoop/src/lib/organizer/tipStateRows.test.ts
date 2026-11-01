import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coinRowFromStoredTipState } from "./tipStateRows.ts";

describe("tipStateRows", () => {
  it("sums unspent values per tip from stored state", () => {
    const row = coinRowFromStoredTipState(
      1,
      "bc1qtest",
      [
        {
          scriptId: 1,
          tip: "core",
          outpointTxid: "aa",
          outpointVout: 0,
          status: "unspent",
          valueSats: 1000n,
        },
        {
          scriptId: 1,
          tip: "core",
          outpointTxid: "bb",
          outpointVout: 1,
          status: "unspent",
          valueSats: 500n,
        },
        {
          scriptId: 1,
          tip: "knots",
          outpointTxid: "aa",
          outpointVout: 0,
          status: "unspent",
          valueSats: 1000n,
        },
      ],
      9
    );
    assert.equal(row.core.valueSats, 1500);
    assert.equal(row.knots.valueSats, 1000);
    assert.equal(row.presence, "both");
    assert.equal(row.watchAccountId, 9);
  });
});
