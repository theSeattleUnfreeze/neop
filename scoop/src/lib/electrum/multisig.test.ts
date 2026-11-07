import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as bip39 from "bip39";
import { BIP32Factory } from "bip32";
import * as ecc from "tiny-secp256k1";
import * as bitcoin from "bitcoinjs-lib";
import {
  expandMultisigAccount,
  isMultisigExtendedKey,
  parseElectrumWalletType,
} from "./multisig.ts";
import { viewFromWalletJson } from "../sparrow/parseWallet.ts";

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);

const ZNET: bitcoin.Network = {
  ...bitcoin.networks.bitcoin,
  bip32: { public: 0x02aa7ed3, private: 0x02aa7a99 },
};

function zpubFromMnemonic(mnemonic: string): string {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const acct = bip32.fromSeed(seed, ZNET).derivePath("m/48'/0'/0'/2'");
  return acct.neutered().toBase58();
}

describe("multisig watch expand", () => {
  it("parses Electrum wallet_type strings", () => {
    assert.deepEqual(parseElectrumWalletType("2of3"), { m: 2, n: 3 });
    assert.equal(parseElectrumWalletType("standard"), null);
  });

  it("rejects placeholder Zpub stubs", () => {
    assert.equal(isMultisigExtendedKey("Zpub"), false);
    assert.throws(
      () =>
        viewFromWalletJson({
          "x1/": { xpub: "Zpub", type: "hardware", derivation: "m/48'/0'/0'/2'" },
          "x2/": { xpub: "Zpub", type: "hardware", derivation: "m/48'/0'/0'/2'" },
          "x3/": { xpub: "Zpub", type: "hardware", derivation: "m/48'/0'/0'/2'" },
          wallet_type: "2of3",
        }),
      /full cosigner keys|redacted/i
    );
  });

  it("expands a 2-of-3 native P2WSH wallet to sorted receive scripts", () => {
    const cosigners = [
      zpubFromMnemonic(
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
      ),
      zpubFromMnemonic(
        "legal winner thank year wave sausage worth useful legal winner thank yellow"
      ),
      zpubFromMnemonic(
        "letter advice cage absurd amount doctor acoustic avoid letter advice cage above"
      ),
    ];
    for (const key of cosigners) {
      assert.equal(isMultisigExtendedKey(key), true);
      assert.equal(key.slice(0, 4), "Zpub");
    }

    const expanded = expandMultisigAccount({
      m: 2,
      cosigners: cosigners.map((extendedKey) => ({
        extendedKey,
        derivation: "m/48'/0'/0'/2'",
      })),
      gapLimit: 3,
    });
    assert.equal(expanded.m, 2);
    assert.equal(expanded.n, 3);
    assert.equal(expanded.scriptKind, "p2wsh");
    assert.equal(expanded.scripts.length, 3);
    assert.match(expanded.scripts[0].address, /^bc1/);
    assert.equal(expanded.scripts[0].scriptPubKeyHex.startsWith("0020"), true);
    // Distinct receive indexes.
    assert.notEqual(expanded.scripts[0].address, expanded.scripts[1].address);
  });

  it("reads an Electrum 2of3 export as a full multisig policy", () => {
    const cosigners = [
      zpubFromMnemonic(
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
      ),
      zpubFromMnemonic(
        "legal winner thank year wave sausage worth useful legal winner thank yellow"
      ),
      zpubFromMnemonic(
        "letter advice cage absurd amount doctor acoustic avoid letter advice cage above"
      ),
    ];
    const view = viewFromWalletJson({
      "x1/": {
        xpub: cosigners[0],
        hw_type: "coldcard",
        root_fingerprint: "aaaaaaaa",
        label: "Coldcard 1",
        type: "hardware",
        derivation: "m/48'/0'/0'/2'",
      },
      "x2/": {
        xpub: cosigners[1],
        hw_type: "coldcard",
        root_fingerprint: "bbbbbbbb",
        label: "Coldcard 2",
        type: "hardware",
        derivation: "m/48'/0'/0'/2'",
      },
      "x3/": {
        xpub: cosigners[2],
        hw_type: "coldcard",
        root_fingerprint: "cccccccc",
        label: "Coldcard 3",
        type: "hardware",
        derivation: "m/48'/0'/0'/2'",
      },
      wallet_type: "2of3",
      use_encryption: false,
    });
    assert.equal(view.policyType, "MULTI");
    assert.equal(view.multisig?.m, 2);
    assert.equal(view.multisig?.n, 3);
    assert.equal(view.multisig?.cosigners.length, 3);
    assert.match(view.note, /multisig receive scripts/i);
  });
});
