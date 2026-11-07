/**
 * Catalog rows are outpoints. An address is the group they sit under.
 * Replay risk is one outpoint unspent on both tips. A mixed address is not.
 */

import { receivedStamp } from "@/lib/catalog/activity";
import { annotate, presenceOf, type Presence, type Tip, type TipView } from "@/lib/catalog/presence";
import type { HistoryItem, ScriptTipSnapshot, UnspentItem } from "@/lib/sync/fetchTip";

export type WitnessState = "hashed" | "published" | "unknown";

/** Most recent non-funding history tx that published this script's witness/pubkey. */
export type WitnessExposure = {
  tip: Tip;
  txid: string;
  height: number | null;
};

export type OutpointRow = ReturnType<typeof annotate> & {
  txid: string;
  vout: number;
  /** True only when this outpoint is unspent on both tips and both snapshots answered. */
  replayRisk: boolean;
  /** False when either indexer failed or was not queried. Presence is then not a split label. */
  classified: boolean;
  witness: WitnessState;
  /** Confirming height of the live funding, when known. */
  receivedHeight: number | null;
  /** Block time of that confirm, when Scoop resolved the header. */
  receivedAt: string | null;
  accountId?: number | null;
  watchAccountId?: number | null;
};

export type AddressGroup<T extends { presence: Presence; witness?: WitnessState }> = {
  key: string;
  scriptId: number;
  address?: string | null;
  /** More than one presence among the outpoints in this group. Not replay risk. */
  mixed: boolean;
  witness: WitnessState;
  outpoints: T[];
};

type LiveSide = {
  txid: string;
  vout: number;
  core?: UnspentItem;
  knots?: UnspentItem;
};

function tipAnswered(snap: ScriptTipSnapshot | undefined): boolean {
  return Boolean(snap?.ok);
}

function spendBeyondUnspent(snap: ScriptTipSnapshot): boolean {
  const funding = new Set(snap.unspent.map((u) => u.tx_hash.toLowerCase()));
  return snap.history.some((h: HistoryItem) => !funding.has(h.tx_hash.toLowerCase()));
}

/** Rank history height so mempool (0) sorts as newest among confirmed heights. */
function exposureRank(height: number): number {
  if (height <= 0) return Number.MAX_SAFE_INTEGER;
  return height;
}

function latestExposureOnTip(snap: ScriptTipSnapshot): WitnessExposure | null {
  if (!snap.ok) return null;
  const funding = new Set(snap.unspent.map((u) => u.tx_hash.toLowerCase()));
  let best: HistoryItem | null = null;
  for (const item of snap.history) {
    if (funding.has(item.tx_hash.toLowerCase())) continue;
    if (!best || exposureRank(item.height) >= exposureRank(best.height)) best = item;
  }
  if (!best) return null;
  return {
    tip: snap.tip,
    txid: best.tx_hash.toLowerCase(),
    height: best.height > 0 ? best.height : null,
  };
}

/**
 * Most recent spend-side history entry across tips (not a live funding tx).
 * When both tips expose, prefer the higher ranked height (mempool wins over confirmed).
 */
export function witnessExposureFromTips(
  core: ScriptTipSnapshot | undefined,
  knots: ScriptTipSnapshot | undefined
): WitnessExposure | null {
  const candidates = [core, knots]
    .filter((s): s is ScriptTipSnapshot => Boolean(s?.ok))
    .map(latestExposureOnTip)
    .filter((e): e is WitnessExposure => e != null);
  if (!candidates.length) return null;
  return candidates.reduce((a, b) =>
    exposureRank(b.height ?? 0) >= exposureRank(a.height ?? 0) ? b : a
  );
}

/** A script's witness is published once either tip has a transaction that is not a current funding tx. */
export function witnessFromTips(
  core: ScriptTipSnapshot | undefined,
  knots: ScriptTipSnapshot | undefined
): WitnessState {
  const sides = [core, knots].filter((s): s is ScriptTipSnapshot => Boolean(s));
  if (!sides.length) return "unknown";
  if (sides.some((s) => s.ok && spendBeyondUnspent(s))) return "published";
  if (sides.some((s) => !s.ok) || sides.length < 2) return "unknown";
  return "hashed";
}

function collectLive(
  core: ScriptTipSnapshot | undefined,
  knots: ScriptTipSnapshot | undefined
): LiveSide[] {
  const map = new Map<string, LiveSide>();
  const add = (tip: "core" | "knots", snap: ScriptTipSnapshot | undefined) => {
    if (!snap?.ok) return;
    for (const u of snap.unspent) {
      const txid = u.tx_hash.toLowerCase();
      const key = `${txid}:${u.tx_pos}`;
      const row = map.get(key) ?? { txid, vout: u.tx_pos };
      row[tip] = u;
      map.set(key, row);
    }
  };
  add("core", core);
  add("knots", knots);
  return [...map.values()].sort((a, b) => a.txid.localeCompare(b.txid) || a.vout - b.vout);
}

function viewOf(
  item: UnspentItem | undefined,
  snap: ScriptTipSnapshot | undefined,
  txid: string,
  vout: number,
  resolvedSpendTxid?: string
): TipView {
  if (!snap?.ok) return { status: "absent" };
  if (item) {
    return {
      status: "unspent",
      txid,
      vout,
      valueSats: item.value,
      confirmedHeight: item.height,
    };
  }
  // The funding transaction is in this tip's history, and the outpoint is not unspent:
  // this tip already spent it. The spend txid comes from a decoded input, not a history guess.
  const seen = snap.history.some((h) => h.tx_hash.toLowerCase() === txid);
  if (!seen) return { status: "absent" };
  const spendTxid = resolvedSpendTxid?.toLowerCase();
  const spend = spendTxid
    ? snap.history.find((h) => h.tx_hash.toLowerCase() === spendTxid)
    : undefined;
  return {
    status: "spent",
    txid,
    vout,
    spendTxid,
    confirmedHeight: spend && spend.height > 0 ? spend.height : undefined,
  };
}

export function outpointRowsFromTips(
  scriptId: number,
  address: string | null | undefined,
  core: ScriptTipSnapshot | undefined,
  knots: ScriptTipSnapshot | undefined,
  opts: {
    accountId?: number | null;
    watchAccountId?: number | null;
    /** prev outpoint key → spend txid, from a decoded spend on that tip. */
    resolvedSpends?: {
      core?: ReadonlyMap<string, string>;
      knots?: ReadonlyMap<string, string>;
    };
  } = {}
): OutpointRow[] {
  const classified = tipAnswered(core) && tipAnswered(knots);
  const witness = witnessFromTips(core, knots);
  return collectLive(core, knots).map((side) => {
    const key = `${side.txid.toLowerCase()}:${side.vout}`;
    const coreView = viewOf(
      side.core,
      core,
      side.txid,
      side.vout,
      opts.resolvedSpends?.core?.get(key)
    );
    const knotsView = viewOf(
      side.knots,
      knots,
      side.txid,
      side.vout,
      opts.resolvedSpends?.knots?.get(key)
    );
    const annotated = annotate({
      scriptId,
      address,
      core: coreView,
      knots: knotsView,
    });
    const replayRisk =
      classified &&
      annotated.presence === "both" &&
      coreView.status === "unspent" &&
      knotsView.status === "unspent";
    const received = receivedStamp(coreView, knotsView);
    return {
      ...annotated,
      txid: side.txid,
      vout: side.vout,
      replayRisk,
      classified,
      witness,
      receivedHeight: received.height,
      receivedAt: received.at?.toISOString() ?? null,
      accountId: opts.accountId ?? null,
      watchAccountId: opts.watchAccountId ?? null,
    };
  });
}

const LIVE: Presence[] = ["core_only", "knots_only", "both"];

export function groupOutpointRows<
  T extends {
    scriptId: number;
    address?: string | null;
    presence: Presence;
    witness?: WitnessState;
    txid?: string;
    vout?: number;
  },
>(rows: T[]): AddressGroup<T>[] {
  const order: string[] = [];
  const byKey = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.scriptId}:${row.address ?? ""}`;
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key)!.push(row);
  }
  return order.map((key) => {
    const outpoints = byKey.get(key)!;
    const presences = new Set(outpoints.map((r) => r.presence).filter((p) => LIVE.includes(p)));
    const witnesses = outpoints.map((r) => r.witness ?? "unknown");
    const witness: WitnessState = witnesses.includes("published")
      ? "published"
      : witnesses.includes("unknown")
        ? "unknown"
        : "hashed";
    return {
      key,
      scriptId: outpoints[0].scriptId,
      address: outpoints[0].address,
      mixed: presences.size > 1,
      witness,
      outpoints,
    };
  });
}

export type SplitSummary = {
  replay: number;
  knotsOnly: number;
  coreOnly: number;
  /** Spent on Core, still unspent on Knots. Not replay, and not a Knots-only coin. */
  coreBound: number;
  unclassified: number;
  publishedScripts: number;
  hashedScripts: number;
};

export function splitSummary(
  rows: {
    presence: Presence;
    replayRisk?: boolean;
    coreBoundOk?: boolean;
    classified?: boolean;
    scriptId: number;
    witness?: WitnessState;
  }[],
  scripts: { id: number; witnessState?: string | null }[] = []
): SplitSummary {
  let replay = 0;
  let knotsOnly = 0;
  let coreOnly = 0;
  let coreBound = 0;
  let unclassified = 0;
  for (const row of rows) {
    if (row.classified === false) {
      unclassified += 1;
      continue;
    }
    if (row.replayRisk) replay += 1;
    else if (row.coreBoundOk) coreBound += 1;
    else if (row.presence === "knots_only") knotsOnly += 1;
    else if (row.presence === "core_only") coreOnly += 1;
  }
  const published = new Set<number>();
  const hashed = new Set<number>();
  for (const row of rows) {
    if (row.witness === "published") published.add(row.scriptId);
    if (row.witness === "hashed") hashed.add(row.scriptId);
  }
  for (const script of scripts) {
    if (script.witnessState === "published") published.add(script.id);
    if (script.witnessState === "hashed") hashed.add(script.id);
  }
  for (const id of published) hashed.delete(id);
  return {
    replay,
    knotsOnly,
    coreOnly,
    coreBound,
    unclassified,
    publishedScripts: published.size,
    hashedScripts: hashed.size,
  };
}

export { presenceOf };
