import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildForks,
  indexWalletsByAddress,
  walletsForAddress,
  type SpendSide,
} from "./forks.ts";

function side(partial: Partial<SpendSide> & Pick<SpendSide, "tip" | "spendTxid">): SpendSide {
  return {
    scriptId: 7,
    prevTxid: "aa".repeat(32),
    prevVout: 0,
    valueSats: "1000",
    parentAddress: "bc1qparent",
    outputs: [
      { vout: 0, valueSats: "600", address: "bc1qdest", scriptLabel: "p2wpkh" },
      { vout: 1, valueSats: "400", address: "bc1qchange", scriptLabel: "p2wpkh" },
    ],
    ...partial,
  };
}

describe("buildForks", () => {
  it("draws two branches when the spend txids differ", () => {
    const forks = buildForks([
      side({ tip: "core", spendTxid: "11".repeat(32) }),
      side({
        tip: "knots",
        spendTxid: "22".repeat(32),
        outputs: [{ vout: 0, valueSats: "1000", address: "bc1qknots", scriptLabel: "p2wpkh" }],
      }),
    ]);
    assert.equal(forks.length, 1);
    assert.equal(forks[0].core.status, "spent");
    assert.equal(forks[0].core.spendTxid, "11".repeat(32));
    assert.equal(forks[0].core.outputs.length, 2);
    assert.equal(forks[0].knots.status, "spent");
    assert.equal(forks[0].knots.outputs[0].address, "bc1qknots");
  });

  it("keeps the other flavor unspent when only one tip has spent", () => {
    const forks = buildForks([side({ tip: "core", spendTxid: "11".repeat(32) })]);
    assert.equal(forks.length, 1);
    assert.equal(forks[0].core.status, "spent");
    assert.equal(forks[0].knots.status, "unspent");
    assert.equal(forks[0].knots.outputs.length, 0);
    assert.equal(forks[0].knots.spendTxid, null);
  });

  it("omits a spill where both tips share the spend txid", () => {
    const forks = buildForks([
      side({ tip: "core", spendTxid: "33".repeat(32) }),
      side({ tip: "knots", spendTxid: "33".repeat(32) }),
    ]);
    assert.equal(forks.length, 0);
  });
});

describe("walletsForAddress", () => {
  const index = indexWalletsByAddress([
    { address: "bc1qDest", id: 4, label: "Cold" },
    { address: "bc1qdest", id: 9, label: "Also" },
    { address: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT", id: 2, label: "Legacy" },
  ]);

  it("returns each organizer wallet that watches a known address", () => {
    const wallets = walletsForAddress(index, "bc1qdest");
    assert.deepEqual(
      wallets.map((w) => w.id).sort(),
      [4, 9]
    );
    assert.equal(wallets.find((w) => w.id === 4)?.label, "Cold");
  });

  it("returns none for an address Scoop does not watch", () => {
    assert.deepEqual(walletsForAddress(index, "bc1qunknown"), []);
    assert.deepEqual(walletsForAddress(index, null), []);
  });

  it("keeps base58 matching case-sensitive", () => {
    assert.equal(walletsForAddress(index, "1BoatSLRHtKNngkdXEeobR76b53LETtpyT")[0]?.label, "Legacy");
    assert.deepEqual(walletsForAddress(index, "1boatslrhtknngkdxeeobr76b53lettpyt"), []);
  });
});
