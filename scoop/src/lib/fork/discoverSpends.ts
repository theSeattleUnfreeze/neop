import type { DecodedOutput, DecodedTx } from "@/lib/fork/decodeTx";
import type { HistoryItem, UnspentItem } from "@/lib/sync/fetchTip";

/** Newest history transactions considered on one sync, so a busy address cannot stall the poll. */
export const SPEND_HISTORY_CAP = 24;

export type KnownOutpoint = {
  txid: string;
  vout: number;
  valueSats: number | null;
};

export type SpendFound = {
  prevTxid: string;
  prevVout: number;
  spendTxid: string;
  valueSats: number | null;
  height: number;
  outputs: DecodedOutput[];
};

export type HistoryTx = DecodedTx & { height: number };

function heightRank(height: number): number {
  if (height <= 0) return Number.MAX_SAFE_INTEGER;
  return height;
}

export function outpointKey(txid: string, vout: number): string {
  return `${txid.toLowerCase()}:${vout}`;
}

export function addressesEqual(a: string, b: string): boolean {
  if (a === b) return true;
  const al = a.toLowerCase();
  if (al.startsWith("bc1") || al.startsWith("tb1") || al.startsWith("bcrt1")) {
    return al === b.toLowerCase();
  }
  return false;
}

export function newestHistory(
  history: HistoryItem[],
  cap = SPEND_HISTORY_CAP
): { txid: string; height: number }[] {
  return [...history]
    .map((item) => ({ txid: item.tx_hash.toLowerCase(), height: item.height }))
    .sort((a, b) => heightRank(b.height) - heightRank(a.height) || a.txid.localeCompare(b.txid))
    .slice(0, cap);
}

/**
 * Txids to fetch for this script on this tip.
 * Returns nothing when every capped history tx is already a recorded spend or a live funding,
 * and no stored spent outpoint is still missing its spend row.
 */
export function txidsToFetch(args: {
  history: HistoryItem[];
  unspent: UnspentItem[];
  knownSpendTxids: ReadonlySet<string>;
  /** Funding txids of spends already stored. They are not spends, but they are resolved. */
  knownPrevTxids?: ReadonlySet<string>;
  unresolvedSpent: number;
}): string[] {
  const newest = newestHistory(args.history);
  if (!newest.length) return [];
  const unspentFunding = new Set(args.unspent.map((u) => u.tx_hash.toLowerCase()));
  const knownPrev = args.knownPrevTxids ?? new Set<string>();
  const unknown = newest.filter(
    (item) =>
      !args.knownSpendTxids.has(item.txid) &&
      !knownPrev.has(item.txid) &&
      !unspentFunding.has(item.txid)
  );
  if (!unknown.length && args.unresolvedSpent === 0) return [];
  return newest.map((item) => item.txid);
}

function outputPaysScript(
  output: DecodedOutput,
  scriptPubKeyHex: string | null,
  address: string | null
): boolean {
  if (scriptPubKeyHex && output.scriptHex.toLowerCase() === scriptPubKeyHex.toLowerCase()) {
    return true;
  }
  if (address && output.address && addressesEqual(address, output.address)) return true;
  return false;
}

/** Confirmed spends outrank mempool; a later confirm outranks an earlier one. */
function spendRank(spend: SpendFound): number {
  return spend.height <= 0 ? 0 : spend.height;
}

export function discoverSpends(args: {
  scriptPubKeyHex: string | null;
  address: string | null;
  txs: HistoryTx[];
  knownOutpoints?: KnownOutpoint[];
}): SpendFound[] {
  const owned = new Map<string, number | null>();
  for (const known of args.knownOutpoints ?? []) {
    owned.set(outpointKey(known.txid, known.vout), known.valueSats);
  }
  for (const tx of args.txs) {
    for (const output of tx.outputs) {
      if (!outputPaysScript(output, args.scriptPubKeyHex, args.address)) continue;
      owned.set(outpointKey(tx.txid, output.vout), output.valueSats);
    }
  }

  const best = new Map<string, SpendFound>();
  for (const tx of args.txs) {
    for (const input of tx.inputs) {
      const key = outpointKey(input.prevTxid, input.prevVout);
      if (!owned.has(key)) continue;
      const found: SpendFound = {
        prevTxid: input.prevTxid.toLowerCase(),
        prevVout: input.prevVout,
        spendTxid: tx.txid.toLowerCase(),
        valueSats: owned.get(key) ?? null,
        height: tx.height,
        outputs: tx.outputs,
      };
      const prev = best.get(key);
      if (!prev || spendRank(found) >= spendRank(prev)) best.set(key, found);
    }
  }
  return [...best.values()];
}
