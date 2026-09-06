"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";

type Props = { id: number };

export function AccountDetailClient({ id }: Props) {
  const [account, setAccount] = useState<{
    id: number;
    label: string;
    notes: string;
    reminder: string;
    source: "manual" | "electrum";
    lastSyncedAt?: string | null;
    manualCoreSats?: string | null;
    manualKnotsSats?: string | null;
  } | null>(null);
  const [scripts, setScripts] = useState<{ id: number; address: string | null; electrumScripthash: string }[]>(
    []
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/organizer/accounts/${id}`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "load failed");
      return;
    }
    setAccount(json.account);
    setScripts(json.scripts ?? []);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const sync = async () => {
    setBusy(true);
    setSyncMsg(null);
    try {
      const res = await fetch(`/api/organizer/accounts/${id}/sync`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "sync failed");
      const n = (json.newNotifications ?? []).length;
      setSyncMsg(
        n
          ? `Synced. ${n} new replay receive alert${n === 1 ? "" : "s"}.`
          : "Synced. No new replay alerts."
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!account && !error) return <p className="muted">Loading…</p>;
  if (!account) return <p className="banner bad">{error}</p>;

  return (
    <div className="scoop-stack">
      <section className="scoop-panel">
        <p className="muted">
          <Link href="/accounts">← Accounts</Link>
        </p>
        <h2>{account.label}</h2>
        {error ? <p className="banner bad">{error}</p> : null}
        {syncMsg ? <p className="banner warn">{syncMsg}</p> : null}
        <label className="field">
          <span>Label</span>
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
            <button type="button" className="scoop-btn ghost" onClick={sync} disabled={busy}>
              <RefreshCw size={16} /> Sync Fulcrum + Shulcrum
            </button>
          ) : null}
        </div>
      </section>

      {account.source === "electrum" ? (
        <section className="scoop-panel">
          <h3>Watched scripts</h3>
          {!scripts.length ? (
            <p className="muted">No scripts linked.</p>
          ) : (
            <ul className="script-list">
              {scripts.map((s) => (
                <li key={s.id} className="mono">
                  {s.address ?? s.electrumScripthash}
                </li>
              ))}
            </ul>
          )}
          <p className="muted">
            <Link href="/catalog">Open catalog</Link> · <Link href="/tasks">Tasks</Link>
          </p>
        </section>
      ) : null}
    </div>
  );
}
