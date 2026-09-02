import type { annotate, Presence } from "@/lib/catalog/presence";
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
  bothCount: number;
  spillCount: number;
  estimate: boolean;
};

export type PortfolioTotals = {
  coreSats: bigint;
  knotsSats: bigint;
  bothCount: number;
  spillCount: number;
  accountCount: number;
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
    coreSats: r.core.status === "unspent" ? (r.core.valueSats ?? 0n) : 0n,
    knotsSats: r.knots.status === "unspent" ? (r.knots.valueSats ?? 0n) : 0n,
    both: r.presence === "both",
    spill: r.spill,
    coreBoundOk: r.coreBoundOk,
  }));
}

export function aggregateAccountBalances(
  accounts: OrganizerAccountBalanceInput[],
  rows: AnnotatedRow[]
): AccountBalance[] {
  const scripts = aggregateScriptBalances(rows);
  return accounts.map((a) => {
    if (a.source === "manual" || !a.watchAccountId) {
      return {
        accountId: a.id,
        coreSats: a.manualCoreSats ?? 0n,
        knotsSats: a.manualKnotsSats ?? 0n,
        bothCount: 0,
        spillCount: 0,
        estimate: true,
      };
    }
    const mine = scripts.filter(
      (s) =>
        s.watchAccountId === a.watchAccountId ||
        s.accountId === a.watchAccountId
    );
    return {
      accountId: a.id,
      coreSats: mine.reduce((acc, s) => acc + s.coreSats, 0n),
      knotsSats: mine.reduce((acc, s) => acc + s.knotsSats, 0n),
      bothCount: mine.filter((s) => s.both).length,
      spillCount: mine.filter((s) => s.spill).length,
      estimate: false,
    };
  });
}

export function portfolioTotals(accountBalances: AccountBalance[]): PortfolioTotals {
  return {
    coreSats: accountBalances.reduce((acc, a) => acc + a.coreSats, 0n),
    knotsSats: accountBalances.reduce((acc, a) => acc + a.knotsSats, 0n),
    bothCount: accountBalances.reduce((acc, a) => acc + a.bothCount, 0),
    spillCount: accountBalances.reduce((acc, a) => acc + a.spillCount, 0),
    accountCount: accountBalances.length,
  };
}

/** JSON-safe bigint → string for API responses. */
export function serializeBigints<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
  );
}
