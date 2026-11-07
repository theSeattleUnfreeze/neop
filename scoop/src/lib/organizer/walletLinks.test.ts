import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  outpointDomId,
  parseOutpointQuery,
  walletOutpointHref,
} from "./walletLinks.ts";

describe("walletLinks", () => {
  it("builds a wallet deep link for an outpoint", () => {
    const txid = "ab".repeat(32);
    assert.equal(
      walletOutpointHref(3, txid, 1),
      `/wallets/3?outpoint=${encodeURIComponent(`${txid}:1`)}`
    );
  });

  it("parses a valid outpoint query", () => {
    const txid = "cd".repeat(32);
    assert.deepEqual(parseOutpointQuery(`${txid}:2`), { txid, vout: 2 });
    assert.equal(parseOutpointQuery("nope"), null);
  });

  it("stable DOM ids", () => {
    assert.equal(outpointDomId("AA".repeat(32), 0), `outpoint-${"aa".repeat(32)}-0`);
  });
});
