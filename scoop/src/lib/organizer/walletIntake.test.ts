import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addressError,
  derivationPathError,
  gapLimitError,
  labelError,
  looksLikeAddress,
  looksLikeXpub,
  parseGapLimit,
  scripthashError,
  xpubError,
} from "./walletIntake.ts";
import { DEFAULT_GAP_LIMIT } from "../electrum/gap.ts";
import { getFixture, materializeWallet } from "../harness/throwawayWallets.ts";

describe("wallet intake validation", () => {
  it("accepts a real zpub and rejects xprv", () => {
    const zpub = materializeWallet(getFixture("native-segwit"), 1).extendedKey;
    assert.equal(looksLikeXpub(zpub), true);
    assert.equal(xpubError(zpub), null);
    assert.equal(looksLikeXpub("xprvabc"), false);
    assert.match(xpubError("xprvabc") ?? "", /private key/);
    assert.ok(xpubError("nope"));
  });

  it("accepts native segwit and 64-hex, rejects junk", () => {
    assert.equal(looksLikeAddress("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"), true);
    assert.equal(looksLikeAddress("ab".repeat(32)), true);
    assert.equal(looksLikeAddress("not-an-address"), false);
    assert.ok(addressError(""));
    assert.equal(scripthashError(""), null);
    assert.ok(scripthashError("zz"));
  });

  it("path and gap rules", () => {
    assert.equal(derivationPathError(""), null);
    assert.equal(derivationPathError("m/84'/0'/0'"), null);
    assert.ok(derivationPathError("84h"));
    assert.equal(gapLimitError("50"), null);
    assert.ok(gapLimitError("0"));
    assert.ok(gapLimitError("9999"));
    assert.equal(parseGapLimit(""), DEFAULT_GAP_LIMIT);
    assert.equal(labelError("  "), "Give this wallet a name.");
    assert.equal(labelError("Sparrow"), null);
  });
});
