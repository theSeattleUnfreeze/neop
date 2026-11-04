import type { UnspentItem } from "@/lib/sync/fetchTip";

export type OutpointKey = string;

export type ReplayReceiveHit = {
  txid: string;
  vout: number;
  valueSats: bigint;
  coreHeight?: number;
  knotsHeight?: number;
};

export type PriorTipOutpoint = {
  tip: "core" | "knots";
  txid: string;
  vout: number;
  status: "unspent" | "spent" | "absent";
};

export function outpointKey(txid: string, vout: number): OutpointKey {
  return `${txid.toLowerCase()}:${vout}`;
}

function indexUnspent(items: UnspentItem[]): Map<OutpointKey, UnspentItem> {
  const m = new Map<OutpointKey, UnspentItem>();
  for (const u of items) {
    m.set(outpointKey(u.tx_hash, u.tx_pos), u);
  }
  return m;
}

/**
 * Same outpoint unspent on both tips — incoming payment replayed to a watched address.
 */
export function isReplayReceive(
  coreUnspent: UnspentItem[],
  knotsUnspent: UnspentItem[]
): ReplayReceiveHit[] {
  const core = indexUnspent(coreUnspent);
  const knots = indexUnspent(knotsUnspent);
  const hits: ReplayReceiveHit[] = [];
  for (const [key, c] of core) {
    const k = knots.get(key);
    if (!k) continue;
    hits.push({
      txid: c.tx_hash.toLowerCase(),
      vout: c.tx_pos,
      valueSats: BigInt(c.value),
      coreHeight: c.height,
      knotsHeight: k.height,
    });
  }
  return hits;
}

/**
 * True when this outpoint was not already unspent on *both* tips in prior state.
 * First sighting of a dual-tip unspent outpoint (or newly completed replay) alerts.
 */
export function isNewReplayReceive(
  hit: ReplayReceiveHit,
  prior: PriorTipOutpoint[]
): boolean {
  const key = outpointKey(hit.txid, hit.vout);
  const corePrior = prior.find(
    (p) => p.tip === "core" && outpointKey(p.txid, p.vout) === key
  );
  const knotsPrior = prior.find(
    (p) => p.tip === "knots" && outpointKey(p.txid, p.vout) === key
  );
  const wasBothUnspent =
    corePrior?.status === "unspent" && knotsPrior?.status === "unspent";
  return !wasBothUnspent;
}

/**
 * Whether sync should create a replay-receive alert for this hit.
 * Bootstrap sync (empty prior) seeds tip state only — no notification flood.
 */
export function shouldCreateReplayAlert(
  hit: ReplayReceiveHit,
  prior: PriorTipOutpoint[]
): boolean {
  if (prior.length === 0) return false;
  return isNewReplayReceive(hit, prior);
}

export function replayDedupeKey(
  scripthash: string,
  txid: string,
  vout: number
): string {
  return `replay:${scripthash.toLowerCase()}:${txid.toLowerCase()}:${vout}`;
}

export type SpentMarker = {
  tip: "core" | "knots";
  txid: string;
  vout: number;
};

/**
 * Remember an outpoint that left one tip and is still unspent on the other.
 * Sync replaces a tip's rows, so a spent marker from the previous sync has to be written again.
 */
export function persistedSpentMarkers(
  prior: PriorTipOutpoint[],
  coreUnspent: UnspentItem[],
  knotsUnspent: UnspentItem[]
): SpentMarker[] {
  const coreNow = new Set(coreUnspent.map((u) => outpointKey(u.tx_hash, u.tx_pos)));
  const knotsNow = new Set(knotsUnspent.map((u) => outpointKey(u.tx_hash, u.tx_pos)));
  const seen = new Set<string>();
  const out: SpentMarker[] = [];
  const push = (tip: "core" | "knots", txid: string, vout: number) => {
    const id = `${tip}:${outpointKey(txid, vout)}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ tip, txid: txid.toLowerCase(), vout });
  };
  for (const row of prior) {
    if (row.status !== "unspent" && row.status !== "spent") continue;
    const key = outpointKey(row.txid, row.vout);
    if (row.tip === "core" && !coreNow.has(key) && knotsNow.has(key)) {
      push("core", row.txid, row.vout);
    }
    if (row.tip === "knots" && !knotsNow.has(key) && coreNow.has(key)) {
      push("knots", row.txid, row.vout);
    }
  }
  return out;
}
