import * as bip39 from "bip39";
import { BIP32Factory } from "bip32";
import * as ecc from "tiny-secp256k1";
import * as bitcoin from "bitcoinjs-lib";
import {
  expandAccountXpub,
  type ScriptKind,
  type DerivedWatchScript,
} from "@/lib/electrum/xpub";

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);

export type ThrowawayWalletFixture = {
  id: string;
  label: string;
  scriptKind: ScriptKind;
  /** BIP39 mnemonic (throwaway only). */
  mnemonic: string;
  accountPath: string;
  /** Optional fixed account xpub; derived from mnemonic if omitted. */
  extendedKey?: string;
};

const SLIP = {
  p2pkh: { public: 0x0488b21e, private: 0x0488ade4, path: "m/44'/0'/0'", prefix: "xpub" },
  p2shp2wpkh: {
    public: 0x049d7cb2,
    private: 0x049d7878,
    path: "m/49'/0'/0'",
    prefix: "ypub",
  },
  p2wpkh: { public: 0x04b24746, private: 0x04b2430c, path: "m/84'/0'/0'", prefix: "zpub" },
  // Taproot account keys are often exported as plain xpub with m/86' path
  p2tr: { public: 0x0488b21e, private: 0x0488ade4, path: "m/86'/0'/0'", prefix: "xpub" },
} as const;

/**
 * Deterministic throwaway wallets for the Scoop import harness.
 * The BIP39 abandon…about vector is enough — tests mock Electrum, they never
 * need real funds. Replace or extend with your own throwaway mnemonics.
 */
export const THROWAWAY_FIXTURES: ThrowawayWalletFixture[] = [
  {
    id: "native-segwit",
    label: "Throwaway native segwit (BIP84)",
    scriptKind: "p2wpkh",
    // BIP-84 abandon… vector — public test mnemonic, not for real funds
    mnemonic:
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    accountPath: "m/84'/0'/0'",
  },
  // Placeholders for follow-on wallets you will supply:
  // { id: "nested-segwit", scriptKind: "p2shp2wpkh", mnemonic: "…", accountPath: "m/49'/0'/0'" },
  // { id: "legacy", scriptKind: "p2pkh", mnemonic: "…", accountPath: "m/44'/0'/0'" },
  // { id: "taproot", scriptKind: "p2tr", mnemonic: "…", accountPath: "m/86'/0'/0'" },
];

export type MaterializedWallet = {
  fixture: ThrowawayWalletFixture;
  extendedKey: string;
  /** Same key re-encoded as bare xpub (for discovery tests). */
  bareXpub: string;
  scripts: DerivedWatchScript[];
};

export function accountXpubFromMnemonic(
  mnemonic: string,
  scriptKind: ScriptKind,
  accountPath?: string
): { extendedKey: string; bareXpub: string; accountPath: string } {
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error("invalid BIP39 mnemonic");
  }
  const slip = SLIP[scriptKind];
  const path = accountPath ?? slip.path;
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const acct = bip32.fromSeed(seed).derivePath(path);
  const slipNet = {
    ...bitcoin.networks.bitcoin,
    bip32: { public: slip.public, private: slip.private },
  };
  const xNet = {
    ...bitcoin.networks.bitcoin,
    bip32: { public: 0x0488b21e, private: 0x0488ade4 },
  };
  const extendedKey = bip32
    .fromPrivateKey(acct.privateKey!, acct.chainCode, slipNet)
    .neutered()
    .toBase58();
  const bareXpub = bip32
    .fromPrivateKey(acct.privateKey!, acct.chainCode, xNet)
    .neutered()
    .toBase58();
  return { extendedKey, bareXpub, accountPath: path };
}

export function materializeWallet(
  fixture: ThrowawayWalletFixture,
  gapLimit = 10
): MaterializedWallet {
  const derived = fixture.extendedKey
    ? {
        extendedKey: fixture.extendedKey,
        bareXpub: fixture.extendedKey,
        accountPath: fixture.accountPath,
      }
    : accountXpubFromMnemonic(fixture.mnemonic, fixture.scriptKind, fixture.accountPath);

  const expanded = expandAccountXpub({
    extendedKey: derived.extendedKey,
    accountPath: derived.accountPath,
    scriptKind: fixture.scriptKind,
    gapLimit,
  });

  // For taproot, extended key is xpub — bareXpub is the same. For zpub/ypub, derive bare form.
  let bareXpub = derived.bareXpub;
  if (derived.extendedKey.startsWith("z") || derived.extendedKey.startsWith("y")) {
    bareXpub = accountXpubFromMnemonic(
      fixture.mnemonic,
      fixture.scriptKind,
      fixture.accountPath
    ).bareXpub;
  }

  return {
    fixture,
    extendedKey: derived.extendedKey,
    bareXpub,
    scripts: expanded.scripts,
  };
}

export function getFixture(id: string): ThrowawayWalletFixture {
  const f = THROWAWAY_FIXTURES.find((w) => w.id === id);
  if (!f) throw new Error(`unknown throwaway fixture: ${id}`);
  return f;
}
