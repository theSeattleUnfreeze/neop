import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  exposureNewest,
  groupOutpointRows,
  outpointRowsFromTips,
  splitSummary,
  witnessExposureFromTips,
  witnessFromTips,
} from "./outpoints.ts";
import type { ScriptTipSnapshot } from "../sync/fetchTip.ts";

function snap(
  tip: "core" | "knots",
  unspent: ScriptTipSnapshot["unspent"],
  history: ScriptTipSnapshot["history"] = unspent.map((u) => ({ tx_hash: u.tx_hash, height: u.height }))
): ScriptTipSnapshot {
  return { tip, scripthash: "00".repeat(32), ok: true, unspent, history };
}

describe("outpoint rows", () => {
  it("keeps a mixed address as separate outpoints and only flags the shared one", () => {
    const rows = outpointRowsFromTips(
      1,
      "bc1qmix",
      snap("core", [
        { tx_hash: "aa", tx_pos: 0, value: 10, height: 1 },
        { tx_hash: "bb", tx_pos: 1, value: 4, height: 1 },
      ]),
      snap("knots", [
        { tx_hash: "aa", tx_pos: 0, value: 10, height: 1 },
        { tx_hash: "cc", tx_pos: 2, value: 7, height: 1 },
      ])
    );
    assert.equal(rows.length, 3);
    const shared = rows.find((r) => r.txid === "aa");
    assert.equal(shared?.replayRisk, true);
    assert.equal(shared?.presence, "both");
    assert.equal(rows.filter((r) => r.replayRisk).length, 1);
    const groups = groupOutpointRows(rows);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].mixed, true);
    assert.equal(groups[0].witness, "hashed");
  });

  it("marks the same outpoint spent on Core and unspent on Knots as core-bound, not replay", () => {
    const txid = "aa".repeat(16);
    const rows = outpointRowsFromTips(
      5,
      "bc1q",
      snap("core", [], [
        { tx_hash: txid, height: 1 },
        { tx_hash: "bb".repeat(16), height: 2 },
      ]),
      snap("knots", [{ tx_hash: txid, tx_pos: 0, value: 42, height: 1 }])
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].core.status, "spent");
    assert.equal(rows[0].core.spendTxid, undefined);
    assert.equal(rows[0].coreBoundOk, true);
    assert.equal(rows[0].replayRisk, false);
  });

  it("attaches a decoded spend txid when the caller resolved that input", () => {
    const txid = "aa".repeat(32);
    const spend = "dd".repeat(32);
    const rows = outpointRowsFromTips(
      5,
      "bc1q",
      snap("core", [], [
        { tx_hash: txid, height: 1 },
        { tx_hash: "bb".repeat(32), height: 2 },
        { tx_hash: spend, height: 3 },
      ]),
      snap("knots", [{ tx_hash: txid, tx_pos: 0, value: 42, height: 1 }]),
      { resolvedSpends: { core: new Map([[`${txid}:0`, spend]]) } }
    );
    assert.equal(rows[0].core.spendTxid, spend);
    assert.equal(rows[0].core.confirmedHeight, 3);
  });

  it("does not treat spent history on one tip as the other tip's live outpoint", () => {
    const rows = outpointRowsFromTips(
      2,
      "bc1q",
      snap("core", [], [{ tx_hash: "spent", height: 1 }]),
      snap("knots", [{ tx_hash: "live", tx_pos: 0, value: 5, height: 2 }])
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].presence, "knots_only");
    assert.equal(rows[0].replayRisk, false);
    assert.equal(rows[0].witness, "published");
  });

  it("names the most recent spend-side history tx as the pubkey exposure", () => {
    const funding = "aa".repeat(32);
    const earlySpend = "bb".repeat(32);
    const lateSpend = "cc".repeat(32);
    const core = snap(
      "core",
      [{ tx_hash: funding, tx_pos: 0, value: 1, height: 10 }],
      [
        { tx_hash: funding, height: 10 },
        { tx_hash: earlySpend, height: 20 },
        { tx_hash: lateSpend, height: 30 },
      ]
    );
    const knots = snap("knots", [{ tx_hash: funding, tx_pos: 0, value: 1, height: 10 }]);
    const exposure = witnessExposureFromTips(core, knots);
    assert.equal(exposure?.tip, "core");
    assert.equal(exposure?.txid, lateSpend);
    assert.equal(exposure?.height, 30);
  });

  it("ranks a mempool exposure ahead of an older confirmed one", () => {
    assert.ok(exposureNewest(null) > exposureNewest(30));
    assert.ok(exposureNewest(0) > exposureNewest(30));
    const funding = "aa".repeat(32);
    const confirmed = "bb".repeat(32);
    const mempool = "cc".repeat(32);
    const core = snap(
      "core",
      [{ tx_hash: funding, tx_pos: 0, value: 1, height: 10 }],
      [
        { tx_hash: funding, height: 10 },
        { tx_hash: confirmed, height: 30 },
      ]
    );
    const knots = snap(
      "knots",
      [{ tx_hash: funding, tx_pos: 0, value: 1, height: 10 }],
      [
        { tx_hash: funding, height: 10 },
        { tx_hash: mempool, height: 0 },
      ]
    );
    const exposure = witnessExposureFromTips(core, knots);
    assert.equal(exposure?.txid, mempool);
    assert.equal(exposure?.height, null);
  });

  it("leaves presence unclassified when an indexer did not answer", () => {
    const rows = outpointRowsFromTips(
      3,
      "bc1q",
      { tip: "core", scripthash: "00", ok: false, unspent: [], history: [], error: "timeout" },
      snap("knots", [{ tx_hash: "kk", tx_pos: 0, value: 1, height: 1 }])
    );
    assert.equal(rows[0].classified, false);
    assert.equal(rows[0].replayRisk, false);
    assert.equal(witnessFromTips(undefined, undefined), "unknown");
  });

  it("does not count a core-bound outpoint in the replay summary", () => {
    const txid = "aa".repeat(16);
    const rows = outpointRowsFromTips(
      6,
      "bc1q",
      snap("core", [], [
        { tx_hash: txid, height: 1 },
        { tx_hash: "bb".repeat(16), height: 2 },
      ]),
      snap("knots", [{ tx_hash: txid, tx_pos: 0, value: 42, height: 1 }])
    );
    const summary = splitSummary(rows);
    assert.equal(summary.replay, 0);
    assert.equal(summary.coreBound, 1);
    assert.equal(summary.knotsOnly, 0);
    assert.equal(rows[0].coreBoundOk, true);
  });

  it("summarizes a split wave without calling a mixed group replay risk", () => {
    const rows = outpointRowsFromTips(
      4,
      "bc1q",
      snap("core", [{ tx_hash: "aa", tx_pos: 0, value: 1, height: 1 }]),
      snap("knots", [
        { tx_hash: "aa", tx_pos: 0, value: 1, height: 1 },
        { tx_hash: "bb", tx_pos: 1, value: 2, height: 1 },
      ])
    );
    const summary = splitSummary(rows);
    assert.equal(summary.replay, 1);
    assert.equal(summary.knotsOnly, 1);
    assert.equal(summary.coreOnly, 0);
    assert.equal(groupOutpointRows(rows)[0].mixed, true);
  });
});
