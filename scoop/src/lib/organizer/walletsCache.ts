/** In-memory + sessionStorage snapshot so /wallets paints without waiting on the API. */

export type CachedActivityStamp = { height: number | null; at: string | null };

export type CachedAccount = {
  id: number;
  label: string;
  reminder: string;
  source: "manual" | "electrum";
  lastSyncedAt?: string | null;
  manualCoreSats?: string | null;
  manualKnotsSats?: string | null;
};

export type CachedCardBalance = {
  coreSats: string;
  knotsSats: string;
  bothCount: number;
  estimate: boolean;
  coreKnown: boolean;
  knotsKnown: boolean;
  lastReceived?: CachedActivityStamp | null;
  lastSent?: CachedActivityStamp | null;
};

export type CachedPortfolio = {
  coreSats: string;
  knotsSats: string;
  coreUtxoCount: number;
  knotsUtxoCount: number;
  utxoCount: number;
  bothCount: number;
  coreKnown: boolean;
  knotsKnown: boolean;
  coreError: string | null;
  knotsError: string | null;
};

export type WalletsOverviewCache = {
  accounts: CachedAccount[];
  balances: [number, CachedCardBalance][];
  portfolio: CachedPortfolio | null;
  savedAt: number;
};

const STORAGE_KEY = "scoop.wallets.overview.v1";

let memory: WalletsOverviewCache | null = null;

export function readWalletsOverviewCache(): WalletsOverviewCache | null {
  if (memory) return memory;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WalletsOverviewCache;
    if (!parsed || !Array.isArray(parsed.accounts) || !Array.isArray(parsed.balances)) {
      return null;
    }
    memory = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export function writeWalletsOverviewCache(
  accounts: CachedAccount[],
  balances: Map<number, CachedCardBalance>,
  portfolio: CachedPortfolio | null
): void {
  const snapshot: WalletsOverviewCache = {
    accounts,
    balances: [...balances.entries()],
    portfolio,
    savedAt: Date.now(),
  };
  memory = snapshot;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Private mode / quota — memory cache still helps soft navigations.
  }
}

export function clearWalletsOverviewCache(): void {
  memory = null;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
