import { DEFAULT_GAP_LIMIT, MAX_GAP_LIMIT, MIN_GAP_LIMIT } from "@/lib/electrum/gap";

export type IntakeKind = "wallet" | "address" | "manual";

export const XPUB_PREFIXES = ["xpub", "ypub", "zpub", "tpub", "upub", "vpub"] as const;

const XPUB_RE = /^(xpub|ypub|zpub|tpub|upub|vpub)[1-9A-HJ-NP-Za-km-z]{79,}$/;
const XPRV_RE = /^(xprv|yprv|zprv|tprv|uprv|vprv)/i;
const PATH_RE = /^m(\/\d+'?)+$/;
const SCRIPTHASH_RE = /^[0-9a-fA-F]{64}$/;
const BECH32_RE = /^(bc1|tb1|bcrt1)[02-9ac-hj-np-z]{20,90}$/i;
const BASE58_RE = /^[13mn2][a-km-zA-HJ-NP-Z1-9]{24,34}$/;

export function looksLikeXpub(value: string): boolean {
  const v = value.trim();
  if (!v || XPRV_RE.test(v)) return false;
  return XPUB_RE.test(v);
}

export function xpubError(value: string): string | null {
  const v = value.trim();
  if (!v) return "Paste an extended public key from Sparrow or Shrike.";
  if (XPRV_RE.test(v)) return "That looks like a private key. Scoop never accepts xprv.";
  if (!XPUB_RE.test(v)) return "Use an xpub, ypub, or zpub (or tpub/upub/vpub on testnet).";
  return null;
}

export function looksLikeAddress(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (SCRIPTHASH_RE.test(v.replace(/^0x/i, ""))) return true;
  return BECH32_RE.test(v) || BASE58_RE.test(v);
}

export function addressError(value: string): string | null {
  const v = value.trim();
  if (!v) return "Paste a Bitcoin address.";
  if (!looksLikeAddress(v)) return "Not a recognized Bitcoin address (bc1… / 3… / 1…) or 64-hex scripthash.";
  return null;
}

export function scripthashError(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!SCRIPTHASH_RE.test(v.replace(/^0x/i, ""))) return "Scripthash must be 64 hex characters.";
  return null;
}

export function derivationPathError(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!PATH_RE.test(v)) return "Use a path like m/84'/0'/0'.";
  return null;
}

export function gapLimitError(value: string): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || String(value).trim() === "") {
    return `Enter a whole number from ${MIN_GAP_LIMIT} to ${MAX_GAP_LIMIT}.`;
  }
  if (n < MIN_GAP_LIMIT || n > MAX_GAP_LIMIT) {
    return `Enter a number from ${MIN_GAP_LIMIT} to ${MAX_GAP_LIMIT}.`;
  }
  return null;
}

export function parseGapLimit(value: string): number {
  if (!value.trim()) return DEFAULT_GAP_LIMIT;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_GAP_LIMIT;
  return Math.min(Math.max(Math.trunc(n), MIN_GAP_LIMIT), MAX_GAP_LIMIT);
}

export function satsError(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!/^\d+$/.test(v)) return "Use a whole number of sats.";
  return null;
}

export function labelError(value: string): string | null {
  if (!value.trim()) return "Give this wallet a name.";
  return null;
}

export { DEFAULT_GAP_LIMIT, MAX_GAP_LIMIT, MIN_GAP_LIMIT };
