import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spendHeightForOutpoint } from "./replayNotifications.ts";

describe("spend height", () => {
  it("uses the only later confirmed transaction", () => {
    const height = spendHeightForOutpoint(
      [
        { tx_hash: "fund", height: 10 },
        { tx_hash: "spend", height: 12 },
      ],
      "fund"
    );
    assert.equal(height, 12);
  });

  it("does not guess when the script has more than one later transaction", () => {
    const height = spendHeightForOutpoint(
      [
        { tx_hash: "fund", height: 10 },
        { tx_hash: "other", height: 11 },
        { tx_hash: "spend", height: 12 },
      ],
      "fund"
    );
    assert.equal(height, null);
  });
});
