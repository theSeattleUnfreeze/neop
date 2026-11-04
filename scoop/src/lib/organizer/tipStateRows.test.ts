import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { outpointRowsFromStored } from "./tipStateRows.ts";

describe("tipStateRows", () => {
  it("emits one row per outpoint and does not mark a mixed address as replay", () => {
    const rows = outpointRowsFromStored(
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
      9,
      "hashed"
    );
    assert.equal(rows.length, 2);
    const both = rows.find((r) => r.txid === "aa");
    const coreOnly = rows.find((r) => r.txid === "bb");
    assert.equal(both?.presence, "both");
    assert.equal(both?.replayRisk, true);
    assert.equal(both?.vout, 0);
    assert.equal(coreOnly?.presence, "core_only");
    assert.equal(coreOnly?.replayRisk, false);
    assert.equal(rows[0].witness, "hashed");
    assert.equal(rows[0].watchAccountId, 9);
    const coreSats = rows.reduce((acc, r) => acc + (r.core.valueSats ?? 0), 0);
    const knotsSats = rows.reduce((acc, r) => acc + (r.knots.valueSats ?? 0), 0);
    assert.equal(coreSats, 1500);
    assert.equal(knotsSats, 1000);
  });
});
