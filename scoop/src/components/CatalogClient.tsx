"use client";

import { useCallback, useState } from "react";
import { RefreshCw } from "lucide-react";
import { CoinTable } from "@/components/CoinTable";
import type { annotate } from "@/lib/catalog/presence";

type Row = ReturnType<typeof annotate>;

type Props = {
  mode: "neapolitan" | "core" | "knots" | "spills";
  title: string;
  blurb: string;
};

export function CatalogClient({ mode, title, blurb }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [health, setHealth] = useState<{
    fulcrumError?: string | null;
    shulcrumError?: string | null;
  }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scripthash, setScripthash] = useState("");
  const [address, setAddress] = useState("");

  const sync = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const scripts = scripthash.trim()
        ? [{ scripthash: scripthash.trim(), address: address.trim() || undefined }]
        : [];
      const syncRes = await fetch("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scripts }),
      });
      const syncJson = await syncRes.json();
      if (!syncRes.ok) throw new Error(syncJson.error ?? "sync failed");
      setHealth({
        fulcrumError: syncJson.health?.fulcrumError,
        shulcrumError: syncJson.health?.shulcrumError,
      });
      const coinRes = await fetch("/api/coins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, rows: syncJson.rows ?? [] }),
      });
      const coinJson = await coinRes.json();
      setRows(coinJson.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [address, mode, scripthash]);

  return (
    <div className="scoop-stack">
      <section className="scoop-panel">
        <h2>{title}</h2>
        <p className="muted">{blurb}</p>
        <div className="legend" aria-label="Presence legend">
          <span className="presence-chip core">Core only</span>
          <span className="presence-chip knots">Knots only</span>
          <span className="presence-chip both">Both</span>
        </div>
      </section>

      <section className="scoop-panel">
        <h3>Watch / sync</h3>
        <p className="muted">
          Paste an Electrum scripthash (64 hex). Optional address label. Leave empty to sync DB
          watches when Postgres is configured.
        </p>
        <label className="field">
          <span>Scripthash</span>
          <input
            value={scripthash}
            onChange={(e) => setScripthash(e.target.value)}
            placeholder="64 hex chars"
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span>Address (label)</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="bc1q…"
            spellCheck={false}
          />
        </label>
        <button type="button" className="scoop-btn" onClick={sync} disabled={busy}>
          <RefreshCw size={16} strokeWidth={2.25} aria-hidden />
          {busy ? "Syncing…" : "Sync Fulcrum + Shulcrum"}
        </button>
        {health.fulcrumError ? (
          <p className="banner warn">Fulcrum: {health.fulcrumError}</p>
        ) : null}
        {health.shulcrumError ? (
          <p className="banner warn">Shulcrum: {health.shulcrumError}</p>
        ) : null}
        {error ? <p className="banner bad">{error}</p> : null}
      </section>

      <section className="scoop-panel">
        <h3>Coins</h3>
        <CoinTable rows={rows} />
      </section>
    </div>
  );
}
