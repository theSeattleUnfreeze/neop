import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isNewReplayReceive,
  isReplayReceive,
  outpointKey,
  replayDedupeKey,
} from "./replayReceive.ts";

const u = (txid: string, vout: number, value: number) => ({
  tx_hash: txid,
  tx_pos: vout,
  value,
  height: 10,
});

describe("replayReceive", () => {
  it("matches shared unspent outpoints", () => {
    const hits = isReplayReceive(
      [u("AA".repeat(32), 0, 5000), u("bb".repeat(32), 1, 1)],
      [u("aa".repeat(32), 0, 5000)]
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].txid, "aa".repeat(32));
    assert.equal(hits[0].valueSats, 5000n);
  });

  it("detects new vs already-known dual-tip unspent", () => {
    const hit = {
      txid: "cc".repeat(32),
      vout: 0,
      valueSats: 1n,
    };
    assert.equal(isNewReplayReceive(hit, []), true);
    assert.equal(
      isNewReplayReceive(hit, [
        { tip: "core", txid: hit.txid, vout: 0, status: "unspent" },
        { tip: "knots", txid: hit.txid, vout: 0, status: "unspent" },
      ]),
      false
    );
    assert.equal(
      isNewReplayReceive(hit, [
        { tip: "core", txid: hit.txid, vout: 0, status: "unspent" },
      ]),
      true
    );
  });

  it("builds stable dedupe keys", () => {
    assert.equal(outpointKey("Ab", 2), "ab:2");
    assert.equal(
      replayDedupeKey("FF".repeat(32), "Aa".repeat(32), 0),
      `replay:${"ff".repeat(32)}:${"aa".repeat(32)}:0`
    );
  });
});
