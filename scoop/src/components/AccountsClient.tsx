"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AccountCard } from "@/components/AccountCard";

type Account = {
  id: number;
  label: string;
  reminder: string;
  source: "manual" | "electrum";
  lastSyncedAt?: string | null;
  manualCoreSats?: string | null;
  manualKnotsSats?: string | null;
};

export function AccountsClient() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [reminder, setReminder] = useState("");
  const [source, setSource] = useState<"manual" | "electrum">("manual");
  const [scripthash, setScripthash] = useState("");
  const [address, setAddress] = useState("");
  const [manualCore, setManualCore] = useState("");
  const [manualKnots, setManualKnots] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/organizer/accounts");
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "failed to load accounts");
      return;
    }
    setAccounts(json.accounts ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        label,
        notes,
        reminder,
        source,
      };
      if (source === "manual") {
        if (manualCore) body.manualCoreSats = manualCore;
        if (manualKnots) body.manualKnotsSats = manualKnots;
      } else if (scripthash.trim()) {
        body.scripts = [
          { scripthash: scripthash.trim(), address: address.trim() || undefined },
        ];
      }
      const res = await fetch("/api/organizer/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "create failed");
      setLabel("");
      setNotes("");
      setReminder("");
      setScripthash("");
      setAddress("");
      setManualCore("");
      setManualKnots("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scoop-stack">
      <section className="scoop-panel">
        <h2>Accounts</h2>
        <p className="muted">
          Wallet locations for pre-fork coins — Sparrow cold, Start9 watches, paper notes. Data stays
          on this host.
        </p>
        {error ? <p className="banner bad">{error}</p> : null}
      </section>

      <section className="scoop-panel">
        <h3>Add account</h3>
        <label className="field">
          <span>Label</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Sparrow cold" />
        </label>
        <label className="field">
          <span>Notes</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Where / how watched" />
        </label>
        <label className="field">
          <span>Reminder</span>
          <input
            value={reminder}
            onChange={(e) => setReminder(e.target.value)}
            placeholder="Check OP_RETURN wedge before spend"
          />
        </label>
        <label className="field">
          <span>Source</span>
          <select value={source} onChange={(e) => setSource(e.target.value as "manual" | "electrum")}>
            <option value="manual">Manual estimate</option>
            <option value="electrum">Electrum-linked</option>
          </select>
        </label>
        {source === "manual" ? (
          <>
            <label className="field">
              <span>Estimated Core sats</span>
              <input value={manualCore} onChange={(e) => setManualCore(e.target.value)} />
            </label>
            <label className="field">
              <span>Estimated Knots sats</span>
              <input value={manualKnots} onChange={(e) => setManualKnots(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <label className="field">
              <span>Scripthash</span>
              <input
                value={scripthash}
                onChange={(e) => setScripthash(e.target.value)}
                placeholder="64 hex"
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>Address (label)</span>
              <input value={address} onChange={(e) => setAddress(e.target.value)} spellCheck={false} />
            </label>
          </>
        )}
        <button type="button" className="scoop-btn" onClick={create} disabled={busy || !label.trim()}>
          {busy ? "Saving…" : "Create"}
        </button>
      </section>

      <section className="scoop-panel">
        <h3>Your accounts</h3>
        {!accounts.length ? (
          <p className="muted">None yet.</p>
        ) : (
          <div className="account-grid">
            {accounts.map((a) => (
              <AccountCard
                key={a.id}
                id={a.id}
                label={a.label}
                reminder={a.reminder}
                source={a.source}
                coreSats={String(a.manualCoreSats ?? "0")}
                knotsSats={String(a.manualKnotsSats ?? "0")}
                bothCount={0}
                openTaskCount={0}
                unreadNotificationCount={0}
                estimate={a.source === "manual"}
                lastSyncedAt={a.lastSyncedAt}
              />
            ))}
          </div>
        )}
        <p className="muted">
          <Link href="/">Back to dashboard</Link>
        </p>
      </section>
    </div>
  );
}
