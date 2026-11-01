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
};

export function AccountsClient() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balances, setBalances] = useState<Map<number, CardBalance>>(new Map());
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
        });
      }
      setBalances(byId);
    } else {
      setBalances(new Map());
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
          Data stays on this host.
        </p>
        {error ? <p className="banner bad">{error}</p> : null}
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
