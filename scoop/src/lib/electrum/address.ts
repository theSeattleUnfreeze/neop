import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import {
  electrumScripthashFromScriptPubKey,
  normalizeScripthash,
} from "@/lib/electrum/scripthash";

bitcoin.initEccLib(ecc);

const NETWORKS = [
  bitcoin.networks.bitcoin,
  bitcoin.networks.testnet,
  bitcoin.networks.regtest,
];

function looksLikeScripthash(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value.trim().replace(/^0x/i, ""));
}

/** Decode a Bitcoin address to Electrum scripthash (mainnet, testnet, or regtest). */
export function scripthashFromAddress(address: string): {
  scripthash: string;
  scriptPubKeyHex: string;
} {
  const trimmed = address.trim();
  if (!trimmed) throw new Error("empty address");
  let lastErr: unknown;
  for (const network of NETWORKS) {
    try {
      const script = bitcoin.address.toOutputScript(trimmed, network);
      return {
        scripthash: electrumScripthashFromScriptPubKey(script),
        scriptPubKeyHex: Buffer.from(script).toString("hex"),
      };
    } catch (err) {
      lastErr = err;
    }
  }
  const hint = trimmed.slice(0, 16);
  const why = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`not a recognized Bitcoin address (${hint}…): ${why}`);
}

/**
 * Accept either a bech32/base58 address or a 64-hex Electrum scripthash.
 * Prefer `address` when both are present.
 */
export function resolveWatch(input: { scripthash?: string; address?: string }): {
  scripthash: string;
  address?: string;
  scriptPubKeyHex?: string;
} {
  const rawAddress = input.address?.trim() || undefined;
  const rawHash = input.scripthash?.trim() || undefined;

  if (rawAddress && !looksLikeScripthash(rawAddress)) {
    const resolved = scripthashFromAddress(rawAddress);
    return {
      scripthash: resolved.scripthash,
      address: rawAddress,
      scriptPubKeyHex: resolved.scriptPubKeyHex,
    };
  }

  const hex = rawHash && looksLikeScripthash(rawHash) ? rawHash : rawAddress;
  if (hex && looksLikeScripthash(hex)) {
    return {
      scripthash: normalizeScripthash(hex),
      address: rawAddress && !looksLikeScripthash(rawAddress) ? rawAddress : undefined,
    };
  }

  if (rawHash && !looksLikeScripthash(rawHash)) {
    const resolved = scripthashFromAddress(rawHash);
    return {
      scripthash: resolved.scripthash,
      address: rawHash,
      scriptPubKeyHex: resolved.scriptPubKeyHex,
    };
  }

  throw new Error("paste a Bitcoin address (or a 64-hex Electrum scripthash)");
}
