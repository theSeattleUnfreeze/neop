"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AccountCard } from "@/components/AccountCard";
import { WalletIntake } from "@/components/WalletIntake";
import {
  readWalletsOverviewCache,
  writeWalletsOverviewCache,
  type CachedAccount,
  type CachedCardBalance,
  type CachedPortfolio,
} from "@/lib/organizer/walletsCache";

type Account = CachedAccount;
type CardBalance = CachedCardBalance;
type Portfolio = CachedPortfolio;
type ActivityStampJson = { height: number | null; at: string | null };

const POLL_MS = 10_000;

function formatSats(value: string, known = true) {
  if (!known) return "unknown";
  try {
    return `${BigInt(value).toLocaleString()} sats`;
  } catch {
    return `${value} sats`;
  }
}

function hydrateFromCache(): {
  accounts: Account[];
  balances: Map<number, CardBalance>;
  portfolio: Portfolio | null;
  ready: boolean;
} {
  const cached = readWalletsOverviewCache();
  if (!cached) {
    return { accounts: [], balances: new Map(), portfolio: null, ready: false };
  }
  return {
    accounts: cached.accounts,
    balances: new Map(cached.balances),
    portfolio: cached.portfolio,
    ready: true,
  };
}

export function AccountsClient() {
  const [snapshot] = useState(hydrateFromCache);
  const [accounts, setAccounts] = useState<Account[]>(snapshot.accounts);
  const [balances, setBalances] = useState<Map<number, CardBalance>>(snapshot.balances);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(snapshot.portfolio);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(snapshot.ready);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const loadInFlight = useRef(false);
  const syncInFlight = useRef(false);
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  const applyOverview = useCallback(
    (nextAccounts: Account[], nextBalances: Map<number, CardBalance>, nextPortfolio: Portfolio | null) => {
      setAccounts(nextAccounts);
      setBalances(nextBalances);
      setPortfolio(nextPortfolio);
      writeWalletsOverviewCache(nextAccounts, nextBalances, nextPortfolio);
      setReady(true);
    },
    []
  );

  const load = useCallback(async () => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    setRefreshing(true);
    setError(null);
    try {
      const [accRes, dashRes] = await Promise.all([
        fetch("/api/organizer/accounts"),
        fetch("/api/organizer/dashboard"),
      ]);
      const accJson = (await accRes.json().catch(() => ({}))) as {
        error?: string;
        accounts?: Account[];
      };
      const dashJson = (await dashRes.json().catch(() => ({}))) as {
        cards?: {
          account: { id: number };
          balance: CardBalance;
          lastReceived?: ActivityStampJson | null;
          lastSent?: ActivityStampJson | null;
        }[];
        portfolio?: Portfolio;
      };
      if (!accRes.ok) {
        setError(accJson.error ?? "failed to load wallets");
        setReady(true);
        return;
      }
      const nextAccounts = accJson.accounts ?? [];
      const byId = new Map<number, CardBalance>();
      if (dashRes.ok) {
        for (const c of dashJson.cards ?? []) {
          byId.set(c.account.id, {
            coreSats: String(c.balance.coreSats),
            knotsSats: String(c.balance.knotsSats),
            bothCount: c.balance.bothCount,
            estimate: c.balance.estimate,
            coreKnown: c.balance.coreKnown !== false,
            knotsKnown: c.balance.knotsKnown !== false,
            lastReceived: c.lastReceived ?? null,
            lastSent: c.lastSent ?? null,
          });
        }
        const p = dashJson.portfolio;
        applyOverview(
          nextAccounts,
          byId,
          p
            ? {
                coreSats: String(p.coreSats ?? 0),
                knotsSats: String(p.knotsSats ?? 0),
                coreUtxoCount: Number(p.coreUtxoCount ?? 0),
                knotsUtxoCount: Number(p.knotsUtxoCount ?? 0),
                utxoCount: Number(p.utxoCount ?? 0),
                bothCount: Number(p.bothCount ?? 0),
                coreKnown: p.coreKnown !== false,
                knotsKnown: p.knotsKnown !== false,
                coreError: p.coreError ?? null,
                knotsError: p.knotsError ?? null,
              }
            : null
        );
      } else {
        applyOverview(nextAccounts, new Map(), null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load wallets");
      setReady(true);
    } finally {
      loadInFlight.current = false;
      setRefreshing(false);
    }
  }, [applyOverview]);

  /** Soft Electrum sync for watched wallets, then refresh the overview. */
  const syncElectrum = useCallback(async () => {
    if (syncInFlight.current) return;
    const electrum = accountsRef.current.filter((a) => a.source === "electrum");
    if (!electrum.length) {
      await load();
      return;
    }
    syncInFlight.current = true;
    try {
      for (const account of electrum) {
        try {
          await fetch(`/api/organizer/accounts/${account.id}/sync`, { method: "POST" });
        } catch {
          // Keep going; overview load still refreshes whatever tip state we have.
        }
      }
      await load();
    } finally {
      syncInFlight.current = false;
    }
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    void (async () => {
      // Paint from cache first (already in state). Soft-refresh overview, then Electrum.
      await load();
      if (cancelled) return;
      void syncElectrum();
      timer = setInterval(() => {
        if (cancelled) return;
        void syncElectrum();
      }, POLL_MS);
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [load, syncElectrum]);

  const hasWallets = accounts.length > 0;
  const intakeOpen = ready && (adding || !hasWallets);

  return (
    <div className="scoop-stack">
      <section className="scoop-panel">
        <div className="section-head">
          <h2>Wallets</h2>
          {ready && refreshing ? <span className="muted tiny">Refreshing…</span> : null}
        </div>
        <p className="muted">
          A <strong>wallet</strong> is an xpub plus derivation path — the set of addresses Scoop
          watches on Core and Knots. An <strong>account</strong> can later group several wallets.
          Data stays on this host. Core and Knots balances stay separate — they are different
          coins.
        </p>
        {error ? <p className="banner bad">{error}</p> : null}
        {ready && hasWallets && portfolio && (!portfolio.coreKnown || !portfolio.knotsKnown) ? (
          <p className="banner warn">
            {!portfolio.coreKnown && !portfolio.knotsKnown
              ? "Neither Electrum tip answered the last sync. Balances are unknown, not zero."
              : !portfolio.coreKnown
                ? `Core Electrum did not answer${portfolio.coreError ? ` (${portfolio.coreError})` : ""}. Core sats are unknown until that tip is up — a zero here would be a lie.`
                : `Knots Electrum did not answer${portfolio.knotsError ? ` (${portfolio.knotsError})` : ""}. Knots sats are unknown until that tip is up.`}{" "}
            Check the <Link href="/stack">Stack</Link> page.
          </p>
        ) : null}
        {ready && hasWallets && portfolio ? (
          <div className="portfolio-strip" aria-label="Watched totals by chain">
            <div>
              <span className="muted">Core sats</span>
              <strong>{formatSats(portfolio.coreSats, portfolio.coreKnown)}</strong>
            </div>
            <div>
              <span className="muted">Knots sats</span>
              <strong>{formatSats(portfolio.knotsSats, portfolio.knotsKnown)}</strong>
            </div>
            <div>
              <span className="muted">UTXOs</span>
              <strong>{portfolio.utxoCount.toLocaleString()}</strong>
            </div>
            <div>
              <span className="muted">Need split</span>
              <strong>
                {portfolio.coreKnown && portfolio.knotsKnown
                  ? portfolio.bothCount.toLocaleString()
                  : "unknown"}
              </strong>
            </div>
            <div>
              <span className="muted">Core UTXOs</span>
              <strong>
                {portfolio.coreKnown ? portfolio.coreUtxoCount.toLocaleString() : "unknown"}
              </strong>
            </div>
            <div>
              <span className="muted">Knots UTXOs</span>
              <strong>
                {portfolio.knotsKnown ? portfolio.knotsUtxoCount.toLocaleString() : "unknown"}
              </strong>
            </div>
          </div>
        ) : null}
      </section>

      {ready ? (
        <WalletIntake
          hasWallets={hasWallets}
          open={intakeOpen}
          onOpen={() => setAdding(true)}
          onClose={() => setAdding(false)}
          onCreated={async () => {
            await load();
            void syncElectrum();
          }}
        />
      ) : (
        <section className="scoop-panel">
          <p className="muted">Loading…</p>
        </section>
      )}

      <section className="scoop-panel">
        <h3>Your wallets</h3>
        {!ready ? (
          <p className="muted">Loading…</p>
        ) : !accounts.length ? (
          <p className="muted">None yet — add a wallet above.</p>
        ) : (
          <div className="account-grid">
            {accounts.map((a) => {
              const bal = balances.get(a.id);
              return (
                <AccountCard
                  key={a.id}
                  id={a.id}
                  label={a.label}
                  reminder={a.reminder}
                  source={a.source}
                  coreSats={bal?.coreSats ?? String(a.manualCoreSats ?? "0")}
                  knotsSats={bal?.knotsSats ?? String(a.manualKnotsSats ?? "0")}
                  bothCount={bal?.bothCount ?? 0}
                  openTaskCount={0}
                  unreadNotificationCount={0}
                  estimate={bal?.estimate ?? a.source === "manual"}
                  coreKnown={bal?.coreKnown}
                  knotsKnown={bal?.knotsKnown}
                  lastSyncedAt={a.lastSyncedAt}
                  lastReceived={bal?.lastReceived}
                  lastSent={bal?.lastSent}
                />
              );
            })}
          </div>
        )}
        <p className="muted">
          <Link href="/">Back to dashboard</Link>
        </p>
      </section>
    </div>
  );
}
