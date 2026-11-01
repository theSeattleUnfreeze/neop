import { BIP32Factory } from "bip32";
import * as ecc from "tiny-secp256k1";
import * as bitcoin from "bitcoinjs-lib";
import { electrumScripthashFromScriptPubKey } from "@/lib/electrum/scripthash";
import { DEFAULT_GAP_LIMIT, MAX_GAP_LIMIT, MIN_GAP_LIMIT } from "@/lib/electrum/gap";

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);

export type ScriptKind = "p2pkh" | "p2shp2wpkh" | "p2wpkh" | "p2tr";

export type DerivedWatchScript = {
  address: string;
  path: string;
  scripthash: string;
  scriptPubKeyHex: string;
  scriptKind: ScriptKind;
};

type PrefixMeta = {
  public: number;
  private: number;
  kind: ScriptKind;
  accountPath: string;
  testnet: boolean;
};

/** SLIP-132 / Sparrow extended-key prefixes. */
const PREFIX: Record<string, PrefixMeta> = {
  xpub: {
    public: 0x0488b21e,
    private: 0x0488ade4,
    kind: "p2pkh",
    accountPath: "m/44'/0'/0'",
    testnet: false,
  },
  ypub: {
    public: 0x049d7cb2,
    private: 0x049d7878,
    kind: "p2shp2wpkh",
    accountPath: "m/49'/0'/0'",
    testnet: false,
  },
  zpub: {
    public: 0x04b24746,
    private: 0x04b2430c,
    kind: "p2wpkh",
    accountPath: "m/84'/0'/0'",
    testnet: false,
  },
  tpub: {
    public: 0x043587cf,
    private: 0x04358394,
    kind: "p2pkh",
    accountPath: "m/44'/1'/0'",
    testnet: true,
  },
  upub: {
    public: 0x044a5262,
    private: 0x044a4e28,
    kind: "p2shp2wpkh",
    accountPath: "m/49'/1'/0'",
    testnet: true,
  },
  vpub: {
    public: 0x045f1cf6,
    private: 0x045f18bc,
    kind: "p2wpkh",
    accountPath: "m/84'/1'/0'",
    testnet: true,
  },
};

export const COMMON_ACCOUNT_PATHS: { path: string; kind: ScriptKind }[] = [
  { path: "m/84'/0'/0'", kind: "p2wpkh" },
  { path: "m/86'/0'/0'", kind: "p2tr" },
  { path: "m/49'/0'/0'", kind: "p2shp2wpkh" },
  { path: "m/44'/0'/0'", kind: "p2pkh" },
  { path: "m/84'/1'/0'", kind: "p2wpkh" },
  { path: "m/86'/1'/0'", kind: "p2tr" },
  { path: "m/49'/1'/0'", kind: "p2shp2wpkh" },
  { path: "m/44'/1'/0'", kind: "p2pkh" },
];

export const DISCOVER_KINDS: ScriptKind[] = ["p2wpkh", "p2tr", "p2shp2wpkh", "p2pkh"];

function networkForMeta(meta: PrefixMeta): bitcoin.Network {
  const base = meta.testnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
  return {
    ...base,
    bip32: { public: meta.public, private: meta.private },
  };
}

export function parseExtendedKey(extendedKey: string): {
  kind: ScriptKind;
  accountPath: string;
  network: bitcoin.Network;
  addrNetwork: bitcoin.Network;
  prefix: string;
  testnet: boolean;
  node: ReturnType<typeof bip32.fromBase58>;
} {
  const raw = extendedKey.trim();
  const prefix = raw.slice(0, 4);
  const meta = PREFIX[prefix];
  if (!meta) {
    throw new Error(
      "unsupported extended key prefix (use xpub/ypub/zpub or tpub/upub/vpub from Sparrow)"
    );
  }
  const network = networkForMeta(meta);
  const node = bip32.fromBase58(raw, network);
  return {
    kind: meta.kind,
    accountPath: meta.accountPath,
    network,
    addrNetwork: meta.testnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin,
    prefix,
    testnet: meta.testnet,
    node,
  };
}

/** @deprecated use parseExtendedKey */
export function toBip32Xpub(extendedKey: string) {
  const p = parseExtendedKey(extendedKey);
  return {
    xpub: extendedKey.trim(),
    kind: p.kind,
    accountPath: p.accountPath,
    network: p.addrNetwork,
    prefix: p.prefix,
  };
}

export function scriptKindFromAccountPath(path: string): ScriptKind | null {
  const p = path.trim().replace(/\/$/, "");
  const hit = COMMON_ACCOUNT_PATHS.find((c) => c.path === p);
  if (hit) return hit.kind;
  if (p.includes("/84'/")) return "p2wpkh";
  if (p.includes("/86'/")) return "p2tr";
  if (p.includes("/49'/")) return "p2shp2wpkh";
  if (p.includes("/44'/")) return "p2pkh";
  return null;
}

export function defaultAccountPathForKind(kind: ScriptKind, testnet = false): string {
  const coin = testnet ? "1'" : "0'";
  if (kind === "p2wpkh") return `m/84'/${coin}/0'`;
  if (kind === "p2tr") return `m/86'/${coin}/0'`;
  if (kind === "p2shp2wpkh") return `m/49'/${coin}/0'`;
  return `m/44'/${coin}/0'`;
}

export function addressFromPubkey(
  publicKey: Buffer,
  kind: ScriptKind,
  network: bitcoin.Network
): { address: string; scriptPubKey: Buffer } {
  if (kind === "p2pkh") {
    const payment = bitcoin.payments.p2pkh({ pubkey: publicKey, network });
    if (!payment.address || !payment.output) throw new Error("p2pkh encode failed");
    return { address: payment.address, scriptPubKey: payment.output };
  }
  if (kind === "p2wpkh") {
    const payment = bitcoin.payments.p2wpkh({ pubkey: publicKey, network });
    if (!payment.address || !payment.output) throw new Error("p2wpkh encode failed");
    return { address: payment.address, scriptPubKey: payment.output };
  }
  if (kind === "p2shp2wpkh") {
    const payment = bitcoin.payments.p2sh({
      redeem: bitcoin.payments.p2wpkh({ pubkey: publicKey, network }),
      network,
    });
    if (!payment.address || !payment.output) throw new Error("p2shp2wpkh encode failed");
    return { address: payment.address, scriptPubKey: payment.output };
  }
  const xOnly = publicKey.length === 33 ? publicKey.subarray(1, 33) : publicKey;
  const payment = bitcoin.payments.p2tr({ internalPubkey: xOnly, network });
  if (!payment.address || !payment.output) throw new Error("p2tr encode failed");
  return { address: payment.address, scriptPubKey: payment.output };
}

export type ExpandXpubOpts = {
  extendedKey: string;
  accountPath?: string;
  gapLimit?: number;
  includeChange?: boolean;
  scriptKind?: ScriptKind;
};

export function expandAccountXpub(opts: ExpandXpubOpts): {
  scripts: DerivedWatchScript[];
  accountPath: string;
  scriptKind: ScriptKind;
  watchKey: string;
} {
  const gap = Math.min(Math.max(opts.gapLimit ?? DEFAULT_GAP_LIMIT, MIN_GAP_LIMIT), MAX_GAP_LIMIT);
  const parsed = parseExtendedKey(opts.extendedKey);
  const kind =
    opts.scriptKind ??
    (opts.accountPath ? scriptKindFromAccountPath(opts.accountPath) : null) ??
    parsed.kind;
  const accountPath =
    opts.accountPath?.trim() || defaultAccountPathForKind(kind, parsed.testnet);

  const scripts: DerivedWatchScript[] = [];
  const pushChain = (chain: 0 | 1) => {
    for (let i = 0; i < gap; i++) {
      const child = parsed.node.derive(chain).derive(i);
      const { address, scriptPubKey } = addressFromPubkey(
        Buffer.from(child.publicKey),
        kind,
        parsed.addrNetwork
      );
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

  return {
    scripts,
    accountPath,
    scriptKind: kind,
    watchKey: opts.extendedKey.trim(),
  };
}
