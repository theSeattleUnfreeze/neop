"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronDown, RefreshCw } from "lucide-react";
import { CoinTable, type ScriptWitness } from "@/components/CoinTable";
import { SplitChecklist } from "@/components/SplitChecklist";
import { SplitForkList } from "@/components/SplitFork";
import type { CoinFork } from "@/lib/fork/forks";
import { formatActivityStamp } from "@/lib/catalog/activity";
import { filterCatalogRows, type CatalogFilter } from "@/lib/catalog/presence";
import type { OutpointRow } from "@/lib/catalog/outpoints";
import {
  DEFAULT_EXPLORER_CORE,
  DEFAULT_EXPLORER_KNOTS,
  type ExplorerBases,
} from "@/lib/explorer/urls";
import { outpointDomId, parseOutpointQuery } from "@/lib/organizer/walletLinks";

type Props = { id: number };

type ActivityStampJson = { height: number | null; at: string | null };

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
  coreKnown?: boolean;
  knotsKnown?: boolean;
};

type Health = {
  fulcrumError?: string | null;
  shulcrumError?: string | null;
};

type Row = OutpointRow;

const SPILL_EXPLAINER =
  "A spill is the same outpoint spent on both Core and Knots — a dual-effect spend. That usually means the transaction replayed (or was broadcast) on both chains. Spills are not the same as “needs split”: those coins are still unspent on both tips.";

const POLL_MS = 10_000;

export function AccountDetailClient({ id }: Props) {
  const searchParams = useSearchParams();
  const highlightOutpoint = parseOutpointQuery(searchParams.get("outpoint"));
  const [account, setAccount] = useState<Account | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [scripts, setScripts] = useState<ScriptWitness[]>([]);
  const [explorers, setExplorers] = useState<ExplorerBases>({
    core: DEFAULT_EXPLORER_CORE,
    knots: DEFAULT_EXPLORER_KNOTS,
  });
  const [balance, setBalance] = useState<Balance | null>(null);
  const [lastReceived, setLastReceived] = useState<ActivityStampJson | null>(null);
  const [lastSent, setLastSent] = useState<ActivityStampJson | null>(null);
  const [health, setHealth] = useState<Health>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [watching, setWatching] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [forks, setForks] = useState<CoinFork[]>([]);
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [editOpen, setEditOpen] = useState(false);
  const syncInFlight = useRef(false);
  const accountSource = useRef<Account["source"] | null>(null);
  /** Unsaved name, notes, reminder, or estimates. Background reload must not clobber these. */
  const draftDirty = useRef(false);
  /** False after a sync error. The 10s poll stays quiet until Sync now succeeds. */
  const watchOk = useRef(true);

  const applyPayload = useCallback((json: {
    account?: Account;
    rows?: Row[];
    scripts?: ScriptWitness[];
    balance?: Balance | null;
    lastReceived?: ActivityStampJson | null;
    lastSent?: ActivityStampJson | null;
    health?: Health;
    explorers?: ExplorerBases;
  }) => {
    if (json.account) {
      accountSource.current = json.account.source;
      if (json.account.source === "electrum" && watchOk.current) setWatching(true);
      const incoming = json.account;
      setAccount((prev) => {
        if (!prev || !draftDirty.current) return incoming;
        return {
          ...incoming,
          label: prev.label,
          notes: prev.notes,
          reminder: prev.reminder,
          manualCoreSats: prev.manualCoreSats,
          manualKnotsSats: prev.manualKnotsSats,
        };
      });
    }
    if (json.rows) setRows(json.rows);
    if (json.scripts) setScripts(json.scripts);
    if (json.balance !== undefined) setBalance(json.balance ?? null);
    if (json.lastReceived !== undefined) setLastReceived(json.lastReceived ?? null);
    if (json.lastSent !== undefined) setLastSent(json.lastSent ?? null);
    if (json.health) setHealth(json.health);
    if (json.explorers?.core && json.explorers?.knots) setExplorers(json.explorers);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/organizer/accounts/${id}`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "load failed");
      return null;
    }
    applyPayload(json);
    try {
      const splits = await fetch(`/api/organizer/splits?accountId=${id}`);
      const splitsJson = await splits.json();
      if (splits.ok && Array.isArray(splitsJson.forks)) setForks(splitsJson.forks);
    } catch {
      /* wallet details still load when the splits route is down */
    }
    return json.account as Account;
  }, [id, applyPayload]);

  const sync = useCallback(
    async (opts: { manual?: boolean } = {}) => {
      if (syncInFlight.current) return;
      syncInFlight.current = true;
      if (opts.manual) {
        setBusy(true);
        setSyncMsg(null);
      }
      try {
        const res = await fetch(`/api/organizer/accounts/${id}/sync`, { method: "POST" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "sync failed");
        if (json.pending) {
          watchOk.current = false;
          setWatching(false);
          setHealth({
            fulcrumError: json.health?.fulcrumError,
            shulcrumError: json.health?.shulcrumError,
          });
          setError("Electrum did not answer. Watching stopped.");
          return;
        }
        watchOk.current = true;
        setWatching(true);
        setError(null);
        setHealth({
          fulcrumError: json.health?.fulcrumError,
          shulcrumError: json.health?.shulcrumError,
        });
        if (json.rows) setRows(json.rows);
        if (json.balance) setBalance(json.balance);
        if (json.lastReceived) setLastReceived(json.lastReceived);
        if (json.lastSent) setLastSent(json.lastSent);
        if (opts.manual) {
          const n = (json.newNotifications ?? []).length;
          setSyncMsg(
            n ? `Synced. ${n} replay alert${n === 1 ? "" : "s"}.` : "Synced."
          );
        }
        // Reload from tip state so receive/sent stamps and spent markers match the DB.
        await load();
      } catch (e) {
        watchOk.current = false;
        setWatching(false);
        setError(e instanceof Error ? e.message : "Watching stopped.");
      } finally {
        syncInFlight.current = false;
        if (opts.manual) setBusy(false);
      }
    },
    [id, load]
  );

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    void (async () => {
      const acc = await load();
      if (cancelled || !acc || acc.source !== "electrum") return;
      // Stay on Watching for the whole poll, including the gap between requests.
      watchOk.current = true;
      setWatching(true);
      void sync({ manual: false });
      timer = setInterval(() => {
        if (cancelled) return;
        if (!watchOk.current) return;
        if (accountSource.current !== "electrum") return;
        void sync({ manual: false });
      }, POLL_MS);
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // Fresh watch loop when navigating between wallets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!highlightOutpoint || !rows.length) return;
    const el = document.getElementById(
      outpointDomId(highlightOutpoint.txid, highlightOutpoint.vout)
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightOutpoint, rows]);

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
      draftDirty.current = false;
      setAccount(json.account);
      setEditOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!account && !error) return <p className="muted">Loading…</p>;
  if (!account) return <p className="banner bad">{error}</p>;

  const filterCounts: Record<CatalogFilter, number> = {
    all: rows.length,
    replay: filterCatalogRows(rows, "replay").length,
    core: filterCatalogRows(rows, "core").length,
    knots: filterCatalogRows(rows, "knots").length,
    spills: filterCatalogRows(rows, "spills").length,
  };

  const FILTERS: { id: CatalogFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "replay", label: "Needs split" },
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
        <div className="section-head">
          <h2>{account.label}</h2>
          <div className="dash-actions">
            {account.source === "electrum" ? (
              <button
                type="button"
                className="scoop-btn ghost"
                onClick={() => void sync({ manual: true })}
                disabled={busy}
              >
                <RefreshCw size={16} className={watching && !busy ? "spin-slow" : undefined} />{" "}
                {busy ? "Syncing…" : watching ? "Watching…" : "Sync now"}
              </button>
            ) : null}
          </div>
        </div>
        {error ? <p className="banner bad">{error}</p> : null}
        {syncMsg ? <p className="banner warn">{syncMsg}</p> : null}
        {health.fulcrumError ? (
          <p className="banner warn">Core Electrum: {health.fulcrumError}</p>
        ) : null}
        {health.shulcrumError ? (
          <p className="banner warn">Knots Electrum: {health.shulcrumError}</p>
        ) : null}
        {balance && (balance.coreKnown === false || balance.knotsKnown === false) ? (
          <p className="banner warn">
            {balance.coreKnown === false && balance.knotsKnown === false
              ? "Neither Electrum tip answered. These balances are unknown, not zero."
              : balance.coreKnown === false
                ? "Core Electrum did not answer. Core sats are unknown until that tip is up."
                : "Knots Electrum did not answer. Knots sats are unknown until that tip is up."}
          </p>
        ) : null}
        {balance ? (
          <div className="portfolio-strip">
            <div>
              <span className="muted">Core</span>
              <strong>
                {balance.coreKnown === false
                  ? "unknown"
                  : `${BigInt(balance.coreSats).toLocaleString()} sats`}
              </strong>
            </div>
            <div>
              <span className="muted">Knots</span>
              <strong>
                {balance.knotsKnown === false
                  ? "unknown"
                  : `${BigInt(balance.knotsSats).toLocaleString()} sats`}
              </strong>
            </div>
            <div>
              <span className="muted">Replay outpoints</span>
              <strong>
                {balance.coreKnown !== false && balance.knotsKnown !== false
                  ? balance.bothCount
                  : "unknown"}
              </strong>
            </div>
            <div>
              <span className="muted">Last received</span>
              <strong>{formatActivityStamp(lastReceived)}</strong>
            </div>
            <div>
              <span className="muted">Last sent</span>
              <strong>{formatActivityStamp(lastSent)}</strong>
            </div>
          </div>
        ) : null}

        <div className="edit-fold">
          <button
            type="button"
            className="edit-fold-toggle"
            aria-expanded={editOpen}
            onClick={() => setEditOpen((v) => !v)}
          >
            <ChevronDown size={16} className={editOpen ? "is-open" : undefined} />
            {editOpen ? "Hide wallet settings" : "Edit wallet"}
          </button>
          {editOpen ? (
            <div className="edit-fold-body">
              <label className="field">
                <span>Name</span>
                <input
                  value={account.label}
                  onChange={(e) => {
                    draftDirty.current = true;
                    setAccount({ ...account, label: e.target.value });
                  }}
                />
              </label>
              <label className="field">
                <span>Notes</span>
                <input
                  value={account.notes}
                  onChange={(e) => {
                    draftDirty.current = true;
                    setAccount({ ...account, notes: e.target.value });
                  }}
                />
              </label>
              <label className="field">
                <span>Reminder</span>
                <input
                  value={account.reminder}
                  onChange={(e) => {
                    draftDirty.current = true;
                    setAccount({ ...account, reminder: e.target.value });
                  }}
                />
              </label>
              {account.source === "manual" ? (
                <>
                  <label className="field">
                    <span>Estimated Core sats</span>
                    <input
                      value={account.manualCoreSats ?? ""}
                      onChange={(e) => {
                        draftDirty.current = true;
                        setAccount({ ...account, manualCoreSats: e.target.value });
                      }}
                    />
                  </label>
                  <label className="field">
                    <span>Estimated Knots sats</span>
                    <input
                      value={account.manualKnotsSats ?? ""}
                      onChange={(e) => {
                        draftDirty.current = true;
                        setAccount({ ...account, manualKnotsSats: e.target.value });
                      }}
                    />
                  </label>
                </>
              ) : null}
              <div className="dash-actions">
                <button type="button" className="scoop-btn" onClick={save} disabled={busy}>
                  Save
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {account.source === "electrum" ? (
        <>
          <SplitChecklist
            rows={rows}
            scripts={scripts}
            explorers={explorers}
            onExplorersChange={setExplorers}
          />
          <section className="scoop-panel">
            <div className="section-head">
              <h3>Splits</h3>
            </div>
            <p className="muted">
              Coins from this wallet that were spent on one flavor, or spent as a different
              transaction on each flavor. Each column is where that spend paid.
            </p>
            <SplitForkList forks={forks} />
          </section>
          <section className="scoop-panel">
            <div className="section-head">
              <h3>Outpoints</h3>
            </div>
            <div className="filter-row" role="tablist" aria-label="Tip filter">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`scoop-btn ghost${filter === f.id ? " is-active-filter" : ""}`}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label} ({filterCounts[f.id]})
                </button>
              ))}
            </div>
            {filter === "spills" ? (
              <p className="muted spill-explainer">{SPILL_EXPLAINER}</p>
            ) : null}
            <CoinTable
              rows={rows}
              filter={filter}
              scripts={scripts}
              explorers={explorers}
              onExplorersChange={setExplorers}
              highlightOutpoint={highlightOutpoint}
              emptyHint={filter === "spills" ? "No spills in this wallet." : undefined}
            />
            <p className="muted">
              Needs split shows outpoints unspent on both chains. Mixed on the address above them is
              not replay risk. Core uses Fulcrum; Knots uses your Blake2b Electrum. Shrike only sees
              Knots.
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}
