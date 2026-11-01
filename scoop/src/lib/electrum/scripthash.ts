import { createHash } from "node:crypto";

/** Electrum scripthash: SHA256(scriptPubKey) reversed, hex. */
export function electrumScripthashFromScriptPubKey(scriptPubKey: Buffer | Uint8Array): string {
  const hash = createHash("sha256").update(scriptPubKey).digest();
  return Buffer.from(hash).reverse().toString("hex");
}

/**
 * For address-list watches without a full script decoder, callers may pass a
 * precomputed scripthash (from bitcoind getaddressinfo / electrum tools).
 */
export function normalizeScripthash(hex: string): string {
  const h = hex.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(h)) {
    throw new Error("electrum scripthash must be 64 hex chars");
  }
  return h;
}
