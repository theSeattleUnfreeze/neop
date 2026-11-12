"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, RefreshCw } from "lucide-react";
import { AccountCard } from "@/components/AccountCard";
import { StackStatus } from "@/components/StackStatus";

type Card = {
  account: {
    id: number;
    label: string;
    reminder: string;
    source: "manual" | "electrum";
    lastSyncedAt?: string | null;
  };
  balance: {
    coreSats: string;
    knotsSats: string;
    bothCount: number;
    estimate: boolean;
    coreKnown?: boolean;
    knotsKnown?: boolean;
  };
  openTaskCount: number;
  unreadNotificationCount: number;
};

type Notif = {
  id: number;
  title: string;
  body: string;
  detectedAt: string;
};

type Dash = {
  portfolio: {
    coreSats: string;
    knotsSats: string;
    coreUtxoCount?: number;
    knotsUtxoCount?: number;
    utxoCount?: number;
    bothCount: number;
    spillCount: number;
    accountCount: number;
    coreKnown?: boolean;
    knotsKnown?: boolean;
    coreError?: string | null;
    knotsError?: string | null;
  };
  cards: Card[];
  unreadNotificationCount: number;
  openTaskCount: number;
};

function TaskSidebar() {
  const [tasks, setTasks] = useState<{ id: number; title: string; kind: string }[]>([]);
  useEffect(() => {
    void fetch("/api/organizer/tasks?status=open")
      .then((r) => r.json())
      .then((j) => setTasks((j.tasks ?? []).slice(0, 5)))
      .catch(() => setTasks([]));
  }, []);
  if (!tasks.length) return <p className="muted">No open tasks.</p>;
  return (
    <ul className="task-list">
      {tasks.map((t) => (
        <li key={t.id} className="task-item">
          <span className={`kind-pill ${t.kind}`}>{t.kind.replace(/_/g, " ")}</span> {t.title}
        </li>
      ))}
    </ul>
  );
}

export function DashboardClient() {
  const [dash, setDash] = useState<Dash | null>(null);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [dRes, nRes] = await Promise.all([
        fetch("/api/organizer/dashboard"),
        fetch("/api/organizer/notifications?filter=unread"),
      ]);
      const dJson = await dRes.json();
      const nJson = await nRes.json();
      if (!dRes.ok) throw new Error(dJson.error ?? "dashboard failed");
      setDash(dJson);
      setNotifs(nJson.notifications ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDash(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const syncAll = useCallback(async () => {
    if (!dash) return;
    setBusy(true);
    setError(null);
    try {
      const electrum = dash.cards.filter((c) => c.account.source === "electrum");
      for (const c of electrum) {
        const res = await fetch(`/api/organizer/accounts/${c.account.id}/sync`, {
          method: "POST",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `sync failed for ${c.account.label}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [dash, load]);

  const markRead = async (id: number) => {
    await fetch(`/api/organizer/notifications/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ read: true }),
    });
    await load();
  };

  return (
    <div className="scoop-stack">
      <StackStatus />
      <section className="scoop-panel dash-hero">
        <div className="dash-hero-row">
          <div>
            <h2>Dashboard</h2>
            <p className="muted">
              Top-level Core / Knots balances across self-hosted wallets. Sync talks only to
              your Fulcrum and Shulcrum.
            </p>
          </div>
          <div className="dash-actions">
            <button
              type="button"
              className="scoop-btn ghost"
              aria-label="Notifications"
              onClick={() => setBellOpen((v) => !v)}
            >
              <Bell size={16} />
              {dash && dash.unreadNotificationCount > 0 ? (
                <span className="notif-count">{dash.unreadNotificationCount}</span>
              ) : null}
            </button>
            <button type="button" className="scoop-btn" onClick={syncAll} disabled={busy || !dash}>
              <RefreshCw size={16} />
              {busy ? "Syncing…" : "Sync all"}
            </button>
          </div>
        </div>
        {bellOpen ? (
          <div className="notif-dropdown">
            {!notifs.length ? (
              <p className="muted">No unread replay alerts.</p>
            ) : (
              <ul>
                {notifs.map((n) => (
                  <li key={n.id}>
                    <strong>{n.title}</strong>
                    <p className="muted">{n.body}</p>
                    <button type="button" className="scoop-btn ghost" onClick={() => markRead(n.id)}>
                      Mark read
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        {dash && dash.unreadNotificationCount > 0 ? (
          <p className="banner warn">
            {dash.unreadNotificationCount} replay receive alert
            {dash.unreadNotificationCount === 1 ? "" : "s"} — coins may need splitting before spend.
          </p>
        ) : null}
        {error ? <p className="banner bad">{error}</p> : null}
        {dash && (dash.portfolio.coreKnown === false || dash.portfolio.knotsKnown === false) ? (
          <p className="banner warn">
            {dash.portfolio.coreKnown === false && dash.portfolio.knotsKnown === false
              ? "Neither Electrum tip answered the last sync. Balances are unknown, not zero."
              : dash.portfolio.coreKnown === false
                ? `Core Electrum did not answer${dash.portfolio.coreError ? ` (${dash.portfolio.coreError})` : ""}. Core totals are unknown, not zero.`
                : `Knots Electrum did not answer${dash.portfolio.knotsError ? ` (${dash.portfolio.knotsError})` : ""}. Knots totals are unknown, not zero.`}{" "}
            Check the <Link href="/stack">Stack</Link> page.
          </p>
        ) : null}
        {dash ? (
          <div className="portfolio-strip">
            <div>
              <span className="muted">Core</span>
              <strong>
                {dash.portfolio.coreKnown === false
                  ? "unknown"
                  : `${BigInt(dash.portfolio.coreSats).toLocaleString()} sats`}
              </strong>
            </div>
            <div>
              <span className="muted">Knots</span>
              <strong>
                {dash.portfolio.knotsKnown === false
                  ? "unknown"
                  : `${BigInt(dash.portfolio.knotsSats).toLocaleString()} sats`}
              </strong>
            </div>
            <div>
              <span className="muted">Replay outpoints / spills</span>
              <strong>
                {dash.portfolio.coreKnown !== false && dash.portfolio.knotsKnown !== false
                  ? `${dash.portfolio.bothCount} / ${dash.portfolio.spillCount}`
                  : "unknown"}
              </strong>
            </div>
            <div>
              <span className="muted">Open tasks</span>
              <strong>
                <Link href="/tasks">{dash.openTaskCount}</Link>
              </strong>
            </div>
          </div>
        ) : !error ? (
          <p className="muted">Loading…</p>
        ) : null}
      </section>

      <section className="scoop-panel">
        <div className="section-head">
          <h3>Open tasks</h3>
          <Link href="/tasks" className="scoop-btn ghost">
            View all
          </Link>
        </div>
        <TaskSidebar />
      </section>

      <section className="scoop-panel">
        <div className="section-head">
          <h3>Wallets</h3>
          <Link href="/wallets" className="scoop-btn ghost">
            Manage
          </Link>
        </div>
        {!dash?.cards.length ? (
          <p className="muted">
            No wallets yet.{" "}
            <Link href="/wallets">Add a wallet</Link> (manual note or Electrum-linked xpub).
          </p>
        ) : (
          <div className="account-grid">
            {dash.cards.map((c) => (
              <AccountCard
                key={c.account.id}
                id={c.account.id}
                label={c.account.label}
                reminder={c.account.reminder}
                source={c.account.source}
                coreSats={String(c.balance.coreSats)}
                knotsSats={String(c.balance.knotsSats)}
                bothCount={c.balance.bothCount}
                openTaskCount={c.openTaskCount}
                unreadNotificationCount={c.unreadNotificationCount}
                estimate={c.balance.estimate}
                coreKnown={c.balance.coreKnown}
                knotsKnown={c.balance.knotsKnown}
                lastSyncedAt={c.account.lastSyncedAt}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
