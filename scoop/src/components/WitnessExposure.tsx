"use client";

import { useState } from "react";
import Link from "next/link";
import { formatActivityStamp } from "@/lib/catalog/activity";
import type { Tip } from "@/lib/catalog/presence";
import {
  explorerBaseForTip,
  isPublicExplorer,
  normalizeExplorerBase,
  txExplorerUrl,
  type ExplorerBases,
} from "@/lib/explorer/urls";

export type WitnessExposureInfo = {
  tip: Tip;
  txid: string;
  height: number | null;
  at?: string | null;
};

const LOCAL = { "content-type": "application/json", "x-scoop-local": "1" };

export function WitnessExposureBadge({
  exposure,
  explorers,
  onExplorersChange,
}: {
  exposure: WitnessExposureInfo | null | undefined;
  explorers: ExplorerBases;
  onExplorersChange?: (next: ExplorerBases) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!exposure?.txid) {
    return <span className="flag witness published">Pubkey exposed on-chain</span>;
  }
  const tipLabel = exposure.tip === "core" ? "Core" : "Knots";
  const base = explorerBaseForTip(explorers, exposure.tip);
  const href = txExplorerUrl(base, exposure.txid);
  const publicExplorer = isPublicExplorer(exposure.tip, base);
  const openLabel = publicExplorer
    ? "Open on public block explorer"
    : "Open on my block explorer";

  const startEdit = () => {
    setDraft(base);
    setSaveError(null);
    setEditing(true);
  };

  const saveExplorer = async () => {
    const normalized = normalizeExplorerBase(draft);
    if (!normalized) {
      setSaveError("Enter an http(s) base URL, no path required.");
      return;
    }
    setBusy(true);
    setSaveError(null);
    try {
      const cfgRes = await fetch("/api/stack/config", { cache: "no-store", headers: LOCAL });
      const cfgJson = await cfgRes.json();
      if (!cfgRes.ok) throw new Error(cfgJson.error ?? "could not load stack config");
      const nextExplorers: ExplorerBases = {
        ...(cfgJson.config?.explorers ?? explorers),
        [exposure.tip]: normalized,
      };
      const res = await fetch("/api/stack/config", {
        method: "PUT",
        headers: LOCAL,
        body: JSON.stringify({ ...cfgJson.config, explorers: nextExplorers }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "save failed");
      const saved: ExplorerBases = json.config?.explorers ?? nextExplorers;
      onExplorersChange?.(saved);
      setEditing(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="witness-exposure">
      <button
        type="button"
        className="flag witness published witness-exposure-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Pubkey exposed on-chain
      </button>
      {open ? (
        <div className="witness-exposure-panel" role="region" aria-label="Pubkey exposure">
          <p>
            Most recent spend-side transaction on <strong>{tipLabel}</strong> that is not a live
            funding outpoint for this script. That broadcast published the pubkey / witness.
          </p>
          <dl className="witness-exposure-meta">
            <div>
              <dt>Chain</dt>
              <dd>{tipLabel}</dd>
            </div>
            <div>
              <dt>Transaction</dt>
              <dd className="mono">{exposure.txid}</dd>
            </div>
            <div>
              <dt>Confirmed</dt>
              <dd>
                {formatActivityStamp({
                  height: exposure.height,
                  at: exposure.at ?? null,
                })}
              </dd>
            </div>
          </dl>
          <p className="muted tiny">
            Opening an explorer leaves this host and may associate the txid with your network path.
          </p>
          <div className="witness-exposure-actions">
            <a className="scoop-btn ghost" href={href} target="_blank" rel="noopener noreferrer">
              {openLabel}
            </a>
            {publicExplorer ? (
              editing ? (
                <div className="witness-explorer-edit">
                  <label className="field">
                    <span>My {tipLabel} block explorer</span>
                    <input
                      value={draft}
                      placeholder={
                        exposure.tip === "core"
                          ? "https://mempool.space"
                          : "https://mempool.guide"
                      }
                      onChange={(e) => setDraft(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  {saveError ? <p className="banner bad">{saveError}</p> : null}
                  <div className="dash-actions">
                    <button
                      type="button"
                      className="scoop-btn"
                      onClick={() => void saveExplorer()}
                      disabled={busy}
                    >
                      {busy ? "Saving…" : "Save explorer"}
                    </button>
                    <button
                      type="button"
                      className="scoop-btn ghost"
                      onClick={() => setEditing(false)}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                  </div>
                  <p className="muted tiny">
                    Also editable on the <Link href="/stack">Stack</Link> page. Env{" "}
                    <span className="mono">
                      {exposure.tip === "core" ? "SCOOP_EXPLORER_CORE" : "SCOOP_EXPLORER_KNOTS"}
                    </span>{" "}
                    overrides stack when set.
                  </p>
                </div>
              ) : (
                <button type="button" className="scoop-btn ghost" onClick={startEdit}>
                  Set my block explorer
                </button>
              )
            ) : null}
          </div>
        </div>
      ) : null}
    </span>
  );
}
