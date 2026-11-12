import { BIP32Factory } from "bip32";
import * as ecc from "tiny-secp256k1";
import * as bitcoin from "bitcoinjs-lib";
import { electrumScripthashFromScriptPubKey } from "@/lib/electrum/scripthash";
import { DEFAULT_GAP_LIMIT, MAX_GAP_LIMIT, MIN_GAP_LIMIT } from "@/lib/electrum/gap";
import type { DerivedWatchScript } from "@/lib/electrum/xpub";

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);

/** Native or nested P2WSH multisig (BIP48). */
export type MultisigScriptKind = "p2wsh" | "p2shp2wsh";

type MultisigPrefixMeta = {
  public: number;
  private: number;
  kind: MultisigScriptKind;
  accountPath: string;
  testnet: boolean;
};

/**
 * SLIP-132 multisig account xpubs.
 * Z/V = BIP48 script-type 2' (native P2WSH). Y/U = script-type 1' (P2SH-P2WSH).
 */
const MULTISIG_PREFIX: Record<string, MultisigPrefixMeta> = {
  Zpub: {
    public: 0x02aa7ed3,
    private: 0x02aa7a99,
    kind: "p2wsh",
    accountPath: "m/48'/0'/0'/2'",
    testnet: false,
  },
  Ypub: {
    public: 0x0295b43f,
    private: 0x0295b005,
    kind: "p2shp2wsh",
    accountPath: "m/48'/0'/0'/1'",
    testnet: false,
  },
  Vpub: {
    public: 0x02575483,
    private: 0x02575048,
    kind: "p2wsh",
    accountPath: "m/48'/1'/0'/2'",
    testnet: true,
  },
  Upub: {
    public: 0x0249120e,
    private: 0x024285b9,
    kind: "p2shp2wsh",
    accountPath: "m/48'/1'/0'/1'",
    testnet: true,
  },
};

export type MultisigCosignerInput = {
  extendedKey: string;
  derivation?: string;
  label?: string;
  masterFingerprint?: string;
};

export type ExpandMultisigOpts = {
  m: number;
  cosigners: MultisigCosignerInput[];
  gapLimit?: number;
  includeChange?: boolean;
};

function networkFor(meta: MultisigPrefixMeta): bitcoin.Network {
  const base = meta.testnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
  return {
    ...base,
    bip32: { public: meta.public, private: meta.private },
  };
}

const MULTISIG_KEY_RE = /^(Zpub|Ypub|Vpub|Upub)[1-9A-HJ-NP-Za-km-z]{79,}$/;

export function isMultisigExtendedKey(extendedKey: string): boolean {
  return MULTISIG_KEY_RE.test(extendedKey.trim());
}

export function parseMultisigExtendedKey(extendedKey: string): {
  kind: MultisigScriptKind;
  accountPath: string;
  addrNetwork: bitcoin.Network;
  prefix: string;
  testnet: boolean;
  node: ReturnType<typeof bip32.fromBase58>;
} {
  const raw = extendedKey.trim();
  const prefix = raw.slice(0, 4);
  const meta = MULTISIG_PREFIX[prefix];
  if (!meta) {
    throw new Error(
      "unsupported multisig key prefix (use Zpub/Ypub from Coldcard or Electrum, or Vpub/Upub on testnet)"
    );
  }
  if (!MULTISIG_KEY_RE.test(raw)) {
    throw new Error(
      "cosigner key is truncated or invalid — export the full Electrum multisig wallet JSON (each Zpub/Ypub is ~111 characters)"
    );
  }
  const network = networkFor(meta);
  let node: ReturnType<typeof bip32.fromBase58>;
  try {
    node = bip32.fromBase58(raw, network);
  } catch {
    throw new Error(
      "cosigner key failed checksum — use the unedited Electrum export, not a redacted example"
    );
  }
  return {
    kind: meta.kind,
    accountPath: meta.accountPath,
    addrNetwork: meta.testnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin,
    prefix,
    testnet: meta.testnet,
    node,
  };
}

function paymentForPubkeys(
  m: number,
  pubkeys: Buffer[],
  kind: MultisigScriptKind,
  network: bitcoin.Network
): { address: string; scriptPubKey: Buffer } {
  const sorted = [...pubkeys].sort((a, b) => a.compare(b));
  const redeem = bitcoin.payments.p2ms({ m, pubkeys: sorted, network });
  if (kind === "p2wsh") {
    const payment = bitcoin.payments.p2wsh({ redeem, network });
    if (!payment.address || !payment.output) throw new Error("p2wsh multisig encode failed");
    return { address: payment.address, scriptPubKey: payment.output };
  }
  const payment = bitcoin.payments.p2sh({
    redeem: bitcoin.payments.p2wsh({ redeem, network }),
    network,
  });
  if (!payment.address || !payment.output) throw new Error("p2shp2wsh multisig encode failed");
  return { address: payment.address, scriptPubKey: payment.output };
}

/**
 * Expand an N-of-M watch-only multisig (Electrum / Coldcard BIP48 account keys).
 * Pubkeys are BIP67-sorted per address. Does not keep private material.
 */
export function expandMultisigAccount(opts: ExpandMultisigOpts): {
  scripts: DerivedWatchScript[];
  accountPath: string;
  scriptKind: MultisigScriptKind;
  watchKey: string;
  m: number;
  n: number;
} {
  const m = opts.m;
  const n = opts.cosigners.length;
  if (!Number.isInteger(m) || m < 1 || m > n) {
    throw new Error("multisig threshold m must be between 1 and the number of cosigners");
  }
  if (n < 2 || n > 15) {
    throw new Error("multisig needs between 2 and 15 cosigners");
  }

  const parsed = opts.cosigners.map((c) => parseMultisigExtendedKey(c.extendedKey));
  const kind = parsed[0].kind;
  const testnet = parsed[0].testnet;
  for (const p of parsed) {
    if (p.kind !== kind || p.testnet !== testnet) {
      throw new Error("every cosigner must use the same multisig script type and network");
    }
  }

  const accountPath =
    opts.cosigners.find((c) => c.derivation?.trim())?.derivation?.trim() || parsed[0].accountPath;
  const gap = Math.min(Math.max(opts.gapLimit ?? DEFAULT_GAP_LIMIT, MIN_GAP_LIMIT), MAX_GAP_LIMIT);
  const network = parsed[0].addrNetwork;
  const scripts: DerivedWatchScript[] = [];

  const pushChain = (chain: 0 | 1) => {
    for (let i = 0; i < gap; i++) {
      const pubs = parsed.map((p) => Buffer.from(p.node.derive(chain).derive(i).publicKey));
      const { address, scriptPubKey } = paymentForPubkeys(m, pubs, kind, network);
      scripts.push({
        address,
        path: `${accountPath}/${chain}/${i}`,
        scripthash: electrumScripthashFromScriptPubKey(scriptPubKey),
        scriptPubKeyHex: scriptPubKey.toString("hex"),
        scriptKind: kind,
      });
    }
  };

  pushChain(0);
  if (opts.includeChange) pushChain(1);

  const fingerprints = opts.cosigners
    .map((c) => (c.masterFingerprint || "").toLowerCase())
    .filter(Boolean);
  const watchKey =
    fingerprints.length === n
      ? `wsh(sortedmulti(${m},${fingerprints.join(",")}))`
      : `wsh(sortedmulti(${m},n=${n}))`;

  return {
    scripts,
    accountPath,
    scriptKind: kind,
    watchKey,
    m,
    n,
  };
}

/** Electrum wallet_type values like "2of3". */
export function parseElectrumWalletType(
  walletType: string
): { m: number; n: number } | null {
  const match = /^(\d+)of(\d+)$/i.exec(walletType.trim());
  if (!match) return null;
  const m = Number(match[1]);
  const n = Number(match[2]);
  if (!Number.isInteger(m) || !Number.isInteger(n) || m < 1 || n < 2 || m > n) return null;
  return { m, n };
}
