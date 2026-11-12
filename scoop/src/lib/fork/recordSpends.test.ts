import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spendWritePlan } from "./recordSpends.ts";

describe("spend write plan", () => {
  it("inserts when the prevout has no row", () => {
    assert.equal(spendWritePlan(undefined, "aa", 2), "insert");
  });

  it("replaces when a later spend of the same prevout has a new txid", () => {
    assert.equal(spendWritePlan({ txid: "aa", outputCount: 2 }, "bb", 2), "replace");
  });

  it("backfills outputs when the event was stored without them", () => {
    assert.equal(spendWritePlan({ txid: "aa", outputCount: 0 }, "aa", 2), "backfill");
  });

  it("leaves a complete row alone", () => {
    assert.equal(spendWritePlan({ txid: "AA", outputCount: 1 }, "aa", 2), "skip");
    assert.equal(spendWritePlan({ txid: "aa", outputCount: 0 }, "aa", 0), "skip");
  });
});
