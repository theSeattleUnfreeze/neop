/**
 * Catalog rows are outpoints. An address is the group they sit under.
 * Replay risk is one outpoint unspent on both tips. A mixed address is not.
 */

import { annotate, presenceOf, type Presence, type TipView } from "@/lib/catalog/presence";
import type { HistoryItem, ScriptTipSnapshot, UnspentItem } from "@/lib/sync/fetchTip";

export type WitnessState = "hashed" | "published" | "unknown";

export type OutpointRow = ReturnType<typeof annotate> & {
  txid: string;
  vout: number;
  /** True only when this outpoint is unspent on both tips and both snapshots answered. */
  replayRisk: boolean;
  /** False when either indexer failed or was not queried. Presence is then not a split label. */
  classified: boolean;
  witness: WitnessState;
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
  vout: number
): TipView {
  if (!snap?.ok) return { status: "absent" };
  if (item) {
    return {
      status: "unspent",
      txid,
      vout,
      valueSats: item.value,
    };
  }
  // The funding transaction is in this tip's history, and the outpoint is not unspent:
  // this tip already spent it. A history entry for a different txid is not this coin.
  const seen = snap.history.some((h) => h.tx_hash.toLowerCase() === txid);
  if (!seen) return { status: "absent" };
  const spend = snap.history.find((h) => h.tx_hash.toLowerCase() !== txid);
  return {
    status: "spent",
    txid,
    vout,
    spendTxid: spend?.tx_hash,
  };
}

export function outpointRowsFromTips(
  scriptId: number,
  address: string | null | undefined,
  core: ScriptTipSnapshot | undefined,
  knots: ScriptTipSnapshot | undefined,
  opts: { accountId?: number | null; watchAccountId?: number | null } = {}
): OutpointRow[] {
  const classified = tipAnswered(core) && tipAnswered(knots);
  const witness = witnessFromTips(core, knots);
  return collectLive(core, knots).map((side) => {
    const coreView = viewOf(side.core, core, side.txid, side.vout);
    const knotsView = viewOf(side.knots, knots, side.txid, side.vout);
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
    return {
      ...annotated,
      txid: side.txid,
      vout: side.vout,
      replayRisk,
      classified,
      witness,
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
