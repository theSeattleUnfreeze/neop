import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockTipLedger } from "./mockTips.ts";
import { getFixture, materializeWallet } from "./throwawayWallets.ts";
import { validateWalletImport } from "./validateImport.ts";

describe("import validation harness", () => {
  it("imports native-segwit zpub as valid p2wpkh without discovery", async () => {
    const wallet = materializeWallet(getFixture("native-segwit"), 5);
    const ledger = new MockTipLedger();
    const result = await validateWalletImport({
      extendedKey: wallet.extendedKey,
      ledger,
      expectScriptKind: "p2wpkh",
      gapLimit: 5,
    });
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.scriptKind, "p2wpkh");
    assert.equal(result.prefixHinted, true);
    assert.equal(result.discovered, false);
    assert.equal(result.scripts.length, 5);
    assert.equal(result.scripts[0].address, wallet.scripts[0].address);
    assert.equal(result.presenceCounts.none, 5);
  });

  it("rejects garbage extended keys", async () => {
    const result = await validateWalletImport({
      extendedKey: "not-an-xpub",
      ledger: new MockTipLedger(),
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0]?.includes("unsupported"));
  });

  it("discovers p2wpkh from bare xpub when ledger funds those scripthashes", async () => {
    const wallet = materializeWallet(getFixture("native-segwit"), 8);
    const ledger = new MockTipLedger();
    // Fund receive index 0 under the true (p2wpkh) scripthash only
    ledger.fundBoth(wallet.scripts[0].scripthash, 100_000);

    const result = await validateWalletImport({
      extendedKey: wallet.bareXpub,
      ledger,
      expectScriptKind: "p2wpkh",
      gapLimit: 8,
      discover: true,
    });
    assert.equal(result.valid, true);
    assert.equal(result.discovered, true);
    assert.equal(result.scriptKind, "p2wpkh");
    assert.equal(result.prefixHinted, false);
    assert.equal(result.presenceCounts.both, 1);
    assert.equal(result.rows[0].presence, "both");
  });

  it("gap: funded index 0 and 5 are both watched within gapLimit 10", async () => {
    const wallet = materializeWallet(getFixture("native-segwit"), 10);
    const ledger = new MockTipLedger();
    ledger.fundCoreOnly(wallet.scripts[0].scripthash, 50_000);
    ledger.fundKnotsOnly(wallet.scripts[5].scripthash, 75_000);

    const result = await validateWalletImport({
      extendedKey: wallet.extendedKey,
      ledger,
      gapLimit: 10,
    });
    assert.equal(result.valid, true);
    assert.equal(result.presenceCounts.core_only, 1);
    assert.equal(result.presenceCounts.knots_only, 1);
    assert.equal(result.presenceCounts.none, 8);
    assert.equal(result.rows[0].presence, "core_only");
    assert.equal(result.rows[5].presence, "knots_only");
    // Inside the gap, empty slots stay none (not dropped)
    assert.equal(result.rows[1].presence, "none");
    assert.equal(result.rows[4].presence, "none");
  });

  it("split coins: core-only, knots-only, and both at different addresses", async () => {
    const wallet = materializeWallet(getFixture("native-segwit"), 4);
    const ledger = new MockTipLedger();
    ledger.fundCoreOnly(wallet.scripts[0].scripthash, 10_000);
    ledger.fundKnotsOnly(wallet.scripts[1].scripthash, 20_000);
    ledger.fundBoth(wallet.scripts[2].scripthash, 30_000);
    // scripts[3] left empty

    const result = await validateWalletImport({
      extendedKey: wallet.extendedKey,
      ledger,
      gapLimit: 4,
    });
    assert.equal(result.presenceCounts.core_only, 1);
    assert.equal(result.presenceCounts.knots_only, 1);
    assert.equal(result.presenceCounts.both, 1);
    assert.equal(result.presenceCounts.none, 1);

    assert.equal(result.rows[0].core.status, "unspent");
    assert.equal(result.rows[0].knots.status, "absent");
    assert.equal(result.rows[1].core.status, "absent");
    assert.equal(result.rows[1].knots.status, "unspent");
    assert.equal(result.rows[2].core.status, "unspent");
    assert.equal(result.rows[2].knots.status, "unspent");
    assert.equal(result.rows[2].core.valueSats, 30_000);
    assert.equal(result.rows[2].knots.valueSats, 30_000);
  });

  it("core-bound pattern: spent on Core, unspent on Knots", async () => {
    const wallet = materializeWallet(getFixture("native-segwit"), 1);
    const ledger = new MockTipLedger();
    const sh = wallet.scripts[0].scripthash;
    ledger.set("core", sh, { sats: 0, spent: true, txid: "aabb".repeat(16) });
    ledger.set("knots", sh, { sats: 42_000, txid: "aabb".repeat(16) });

    const result = await validateWalletImport({
      extendedKey: wallet.extendedKey,
      ledger,
      gapLimit: 1,
    });
    assert.equal(result.rows[0].coreBoundOk, true);
    assert.equal(result.rows[0].presence, "both"); // both tips have non-absent status
  });
});
