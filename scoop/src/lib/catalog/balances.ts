import { sameUnspentOutpoint, type annotate, type Presence } from "@/lib/catalog/presence";
import type { TipKnowledge } from "@/lib/organizer/tipHealth";
import type { UnspentItem } from "@/lib/sync/fetchTip";

export type AnnotatedRow = ReturnType<typeof annotate> & {
  accountId?: number | null;
  watchAccountId?: number | null;
};

export type OrganizerAccountBalanceInput = {
  id: number;
  source: "manual" | "electrum";
  watchAccountId?: number | null;
  manualCoreSats?: bigint | null;
  manualKnotsSats?: bigint | null;
};

export type ScriptBalance = {
  scriptId: number;
  accountId?: number | null;
  watchAccountId?: number | null;
  address?: string | null;
  presence: Presence;
  coreSats: bigint;
  knotsSats: bigint;
  both: boolean;
  spill: boolean;
  coreBoundOk: boolean;
};

export type AccountBalance = {
  accountId: number;
  coreSats: bigint;
  knotsSats: bigint;
  /** Unspent on Core (includes coins that also remain on Knots). */
  coreUtxoCount: number;
  /** Unspent on Knots (includes coins that also remain on Core). */
  knotsUtxoCount: number;
  /** Distinct outpoints unspent on at least one tip. */
  utxoCount: number;
  /** Still dual-unspent — need a split before a safe single-chain spend. */
  bothCount: number;
  spillCount: number;
  estimate: boolean;
  /** False when Core Electrum did not answer; coreSats is not a real zero. */
  coreKnown: boolean;
  /** False when Knots Electrum did not answer; knotsSats is not a real zero. */
  knotsKnown: boolean;
};

export type PortfolioTotals = {
  coreSats: bigint;
  knotsSats: bigint;
  coreUtxoCount: number;
  knotsUtxoCount: number;
  utxoCount: number;
  bothCount: number;
  spillCount: number;
  accountCount: number;
  coreKnown: boolean;
  knotsKnown: boolean;
  coreError: string | null;
  knotsError: string | null;
};

/** Sum all unspent outputs (not just the first). */
export function sumUnspent(items: UnspentItem[] | undefined | null): bigint {
  if (!items?.length) return 0n;
  return items.reduce((acc, u) => acc + BigInt(u.value), 0n);
}

export function aggregateScriptBalances(rows: AnnotatedRow[]): ScriptBalance[] {
  return rows.map((r) => ({
    scriptId: r.scriptId,
    accountId: r.accountId ?? null,
    watchAccountId: r.watchAccountId ?? null,
    address: r.address,
    presence: r.presence,
    coreSats: r.core.status === "unspent" ? BigInt(r.core.valueSats ?? 0) : 0n,
    knotsSats: r.knots.status === "unspent" ? BigInt(r.knots.valueSats ?? 0) : 0n,
    both: sameUnspentOutpoint(r.core, r.knots),
    spill: r.spill,
    coreBoundOk: r.coreBoundOk,
  }));
}

export function aggregateAccountBalances(
  accounts: OrganizerAccountBalanceInput[],
  rows: AnnotatedRow[],
  tips: TipKnowledge = {
    core: true,
    knots: true,
    coreError: null,
    knotsError: null,
  }
): AccountBalance[] {
  const scripts = aggregateScriptBalances(rows);
  return accounts.map((a) => {
    if (a.source === "manual" || !a.watchAccountId) {
      return {
        accountId: a.id,
        coreSats: a.manualCoreSats ?? 0n,
        knotsSats: a.manualKnotsSats ?? 0n,
        coreUtxoCount: 0,
        knotsUtxoCount: 0,
        utxoCount: 0,
        bothCount: 0,
        spillCount: 0,
        estimate: true,
        coreKnown: true,
        knotsKnown: true,
      };
    }
    const mine = scripts.filter(
      (s) =>
        s.watchAccountId === a.watchAccountId ||
        s.accountId === a.watchAccountId
    );
    const coreKnown = tips.core;
    const knotsKnown = tips.knots;
    const coreUtxoCount = coreKnown ? mine.filter((s) => s.coreSats > 0n).length : 0;
    const knotsUtxoCount = knotsKnown ? mine.filter((s) => s.knotsSats > 0n).length : 0;
    return {
      accountId: a.id,
      coreSats: coreKnown ? mine.reduce((acc, s) => acc + s.coreSats, 0n) : 0n,
      knotsSats: knotsKnown ? mine.reduce((acc, s) => acc + s.knotsSats, 0n) : 0n,
      coreUtxoCount,
      knotsUtxoCount,
      utxoCount: mine.filter((s) => {
        const onCore = coreKnown && s.coreSats > 0n;
        const onKnots = knotsKnown && s.knotsSats > 0n;
        return onCore || onKnots;
      }).length,
      bothCount: coreKnown && knotsKnown ? mine.filter((s) => s.both).length : 0,
      spillCount: mine.filter((s) => s.spill).length,
      estimate: false,
      coreKnown,
      knotsKnown,
    };
  });
}

export function portfolioTotals(
  accountBalances: AccountBalance[],
  tips: TipKnowledge = {
    core: true,
    knots: true,
    coreError: null,
    knotsError: null,
  }
): PortfolioTotals {
  const electrum = accountBalances.filter((a) => !a.estimate);
  const coreKnown = tips.core || electrum.length === 0;
  const knotsKnown = tips.knots || electrum.length === 0;
  return {
    coreSats: coreKnown
      ? accountBalances.reduce((acc, a) => acc + (a.coreKnown ? a.coreSats : 0n), 0n)
      : 0n,
    knotsSats: knotsKnown
      ? accountBalances.reduce((acc, a) => acc + (a.knotsKnown ? a.knotsSats : 0n), 0n)
      : 0n,
    coreUtxoCount: accountBalances.reduce((acc, a) => acc + a.coreUtxoCount, 0),
    knotsUtxoCount: accountBalances.reduce((acc, a) => acc + a.knotsUtxoCount, 0),
    utxoCount: accountBalances.reduce((acc, a) => acc + a.utxoCount, 0),
    bothCount: accountBalances.reduce((acc, a) => acc + a.bothCount, 0),
    spillCount: accountBalances.reduce((acc, a) => acc + a.spillCount, 0),
    accountCount: accountBalances.length,
    coreKnown,
    knotsKnown,
    coreError: coreKnown ? null : tips.coreError,
    knotsError: knotsKnown ? null : tips.knotsError,
  };
}

/** Parse manual sats from API input; null clears the field. */
export function parseSatsInput(
  value: string | number | null | undefined
): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return BigInt(value);
  } catch {
    throw new Error("invalid sats value");
  }
}

/** JSON-safe bigint → string for API responses. */
export function serializeBigints<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
  );
}
