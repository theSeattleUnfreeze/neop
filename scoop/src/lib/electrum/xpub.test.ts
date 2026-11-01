import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as bip39 from "bip39";
import { BIP32Factory } from "bip32";
import * as ecc from "tiny-secp256k1";
import * as bitcoin from "bitcoinjs-lib";
import { expandAccountXpub, parseExtendedKey } from "./xpub.ts";

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);

function bip84AccountZpub(): string {
  const seed = bip39.mnemonicToSeedSync(
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
  );
  const acct = bip32.fromSeed(seed).derivePath("m/84'/0'/0'");
  const znet = {
    ...bitcoin.networks.bitcoin,
    bip32: { public: 0x04b24746, private: 0x04b2430c },
  };
  return bip32.fromPrivateKey(acct.privateKey!, acct.chainCode, znet).neutered().toBase58();
}

describe("xpub expand", () => {
  it("expands BIP84 abandon zpub to first receive address", () => {
    const zpub = bip84AccountZpub();
    assert.match(zpub, /^zpub/);
    const r = expandAccountXpub({ extendedKey: zpub, gapLimit: 2 });
    assert.equal(r.scriptKind, "p2wpkh");
    assert.equal(r.accountPath, "m/84'/0'/0'");
    assert.equal(r.scripts[0].address, "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
    assert.equal(r.scripts[0].path, "m/84'/0'/0'/0/0");
    assert.match(r.scripts[0].scripthash, /^[0-9a-f]{64}$/);
  });

  it("accountPath override forces script kind on bare xpub", () => {
    const zpub = bip84AccountZpub();
    // Re-encode as xpub bytes but keep same key material via parse + wrong kind override
    const parsed = parseExtendedKey(zpub);
    const xnet = {
      ...bitcoin.networks.bitcoin,
      bip32: { public: 0x0488b21e, private: 0x0488ade4 },
    };
    const asXpub = bip32
      .fromPublicKey(parsed.node.publicKey, parsed.node.chainCode, xnet)
      .toBase58();
    assert.match(asXpub, /^xpub/);
    const r = expandAccountXpub({
      extendedKey: asXpub,
      accountPath: "m/84'/0'/0'",
      gapLimit: 1,
    });
    assert.equal(r.scriptKind, "p2wpkh");
    assert.equal(r.scripts[0].address, "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
  });

  it("includeChange adds 1/i chain", () => {
    const zpub = bip84AccountZpub();
    const r = expandAccountXpub({ extendedKey: zpub, gapLimit: 2, includeChange: true });
    assert.equal(r.scripts.length, 4);
    assert.ok(r.scripts.some((s) => s.path.endsWith("/1/0")));
  });

  it("defaults to 50 receive addresses and allows up to 200", () => {
    const zpub = bip84AccountZpub();
    const d = expandAccountXpub({ extendedKey: zpub });
    assert.equal(d.scripts.length, 50);
    const max = expandAccountXpub({ extendedKey: zpub, gapLimit: 500 });
    assert.equal(max.scripts.length, 200);
  });
});
