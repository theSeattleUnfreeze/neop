"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { CoinTable } from "@/components/CoinTable";
import type { annotate, CatalogFilter } from "@/lib/catalog/presence";

type Props = { id: number };

type Account = {
  id: number;
  label: string;
  notes: string;
  reminder: string;
  source: "manual" | "electrum";
  lastSyncedAt?: string | null;
  manualCoreSats?: string | null;
  manualKnotsSats?: string | null;
};

type Balance = {
  coreSats: string;
  knotsSats: string;
  bothCount: number;
  spillCount?: number;
};

type Health = {
  fulcrumError?: string | null;
  shulcrumError?: string | null;
};

type Row = ReturnType<typeof annotate>;

export function AccountDetailClient({ id }: Props) {
  const [account, setAccount] = useState<Account | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [health, setHealth] = useState<Health>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const autoSyncFor = useRef<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/organizer/accounts/${id}`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "load failed");
      return null;
    }
    setAccount(json.account);
    setRows(json.rows ?? []);
    setBalance(json.balance ?? null);
    return json.account as Account;
  }, [id]);

  const sync = useCallback(async () => {
    setBusy(true);
    setSyncMsg(null);
    try {
      const res = await fetch(`/api/organizer/accounts/${id}/sync`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "sync failed");
      setHealth({
        fulcrumError: json.health?.fulcrumError,
        shulcrumError: json.health?.shulcrumError,
      });
      if (json.rows) setRows(json.rows);
      if (json.balance) setBalance(json.balance);
      const n = (json.newNotifications ?? []).length;
      setSyncMsg(
        n ? `Synced. ${n} replay alert${n === 1 ? "" : "s"}.` : "Synced."
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [id, load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const acc = await load();
      if (cancelled || !acc) return;
      if (acc.source !== "electrum") return;
      if (autoSyncFor.current === id) return;
      autoSyncFor.current = id;
      await sync();
    })();
    return () => {
      cancelled = true;
    };
    // Sync once per wallet visit so older imports (tip state never saved) get balances.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const save = async () => {
    if (!account) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/organizer/accounts/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: account.label,
          notes: account.notes,
          reminder: account.reminder,
          manualCoreSats: account.manualCoreSats,
          manualKnotsSats: account.manualKnotsSats,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "save failed");
      setAccount(json.account);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!account && !error) return <p className="muted">Loading…</p>;
  if (!account) return <p className="banner bad">{error}</p>;

  const FILTERS: { id: CatalogFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "core", label: "Core" },
    { id: "knots", label: "Knots" },
    { id: "spills", label: "Spills" },
  ];

  return (
    <div className="scoop-stack">
      <section className="scoop-panel">
        <p className="muted">
          <Link href="/wallets">← Wallets</Link>
        </p>
        <h2>{account.label}</h2>
        {error ? <p className="banner bad">{error}</p> : null}
        {syncMsg ? <p className="banner warn">{syncMsg}</p> : null}
        {health.fulcrumError ? (
          <p className="banner warn">Core Electrum: {health.fulcrumError}</p>
        ) : null}
        {health.shulcrumError ? (
          <p className="banner warn">Knots Electrum: {health.shulcrumError}</p>
        ) : null}
        {balance ? (
          <div className="portfolio-strip">
            <div>
              <span className="muted">Core</span>
              <strong>{BigInt(balance.coreSats).toLocaleString()} sats</strong>
            </div>
            <div>
              <span className="muted">Knots</span>
              <strong>{BigInt(balance.knotsSats).toLocaleString()} sats</strong>
            </div>
            <div>
              <span className="muted">Both</span>
              <strong>{balance.bothCount}</strong>
            </div>
          </div>
        ) : null}
        <label className="field">
          <span>Name</span>
          <input
            value={account.label}
            onChange={(e) => setAccount({ ...account, label: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Notes</span>
          <input
            value={account.notes}
            onChange={(e) => setAccount({ ...account, notes: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Reminder</span>
          <input
            value={account.reminder}
            onChange={(e) => setAccount({ ...account, reminder: e.target.value })}
          />
        </label>
        {account.source === "manual" ? (
          <>
            <label className="field">
              <span>Estimated Core sats</span>
              <input
                value={account.manualCoreSats ?? ""}
                onChange={(e) => setAccount({ ...account, manualCoreSats: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Estimated Knots sats</span>
              <input
                value={account.manualKnotsSats ?? ""}
                onChange={(e) => setAccount({ ...account, manualKnotsSats: e.target.value })}
              />
            </label>
          </>
        ) : null}
        <div className="dash-actions">
          <button type="button" className="scoop-btn" onClick={save} disabled={busy}>
            Save
          </button>
          {account.source === "electrum" ? (
            <button type="button" className="scoop-btn ghost" onClick={() => void sync()} disabled={busy}>
              <RefreshCw size={16} /> {busy ? "Syncing…" : "Sync Electrum"}
            </button>
          ) : null}
        </div>
      </section>

      {account.source === "electrum" ? (
        <section className="scoop-panel">
          <div className="section-head">
            <h3>Addresses</h3>
          </div>
          <div className="filter-row" role="tablist" aria-label="Tip filter">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`scoop-btn ghost${filter === f.id ? " is-active-filter" : ""}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <CoinTable rows={rows} filter={filter} />
          <p className="muted">
            All / Core / Knots / Spills filter this table — they do not change page. Core uses
            Fulcrum; Knots uses your Blake2b Electrum. Shrike only sees Knots.
          </p>
        </section>
      ) : null}
    </div>
  );
}
