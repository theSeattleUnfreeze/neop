"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AccountCard } from "@/components/AccountCard";
import { WalletIntake } from "@/components/WalletIntake";

type Account = {
  id: number;
  label: string;
  reminder: string;
  source: "manual" | "electrum";
  lastSyncedAt?: string | null;
  manualCoreSats?: string | null;
  manualKnotsSats?: string | null;
};

type CardBalance = {
  coreSats: string;
  knotsSats: string;
  bothCount: number;
  estimate: boolean;
  coreKnown: boolean;
  knotsKnown: boolean;
};

type Portfolio = {
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

function formatSats(value: string, known = true) {
  if (!known) return "unknown";
  try {
    return `${BigInt(value).toLocaleString()} sats`;
  } catch {
    return `${value} sats`;
  }
}

export function AccountsClient() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balances, setBalances] = useState<Map<number, CardBalance>>(new Map());
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [accRes, dashRes] = await Promise.all([
      fetch("/api/organizer/accounts"),
      fetch("/api/organizer/dashboard"),
    ]);
    const accJson = await accRes.json();
    const dashJson = await dashRes.json();
    if (!accRes.ok) {
      setError(accJson.error ?? "failed to load wallets");
      setReady(true);
      return;
    }
    setAccounts(accJson.accounts ?? []);
    if (dashRes.ok) {
      const byId = new Map<number, CardBalance>();
      for (const c of dashJson.cards ?? []) {
        byId.set(c.account.id, {
          coreSats: String(c.balance.coreSats),
          knotsSats: String(c.balance.knotsSats),
          bothCount: c.balance.bothCount,
          estimate: c.balance.estimate,
          coreKnown: c.balance.coreKnown !== false,
          knotsKnown: c.balance.knotsKnown !== false,
        });
      }
      setBalances(byId);
      const p = dashJson.portfolio;
      setPortfolio(
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
      setBalances(new Map());
      setPortfolio(null);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasWallets = accounts.length > 0;
  const intakeOpen = ready && (adding || !hasWallets);

  return (
    <div className="scoop-stack">
      <section className="scoop-panel">
        <h2>Wallets</h2>
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
          onCreated={load}
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
