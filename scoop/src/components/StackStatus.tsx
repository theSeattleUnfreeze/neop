"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { localServicesToStart, type StartOffer } from "@/lib/stack/startOffer";
import type { StackStatusRow } from "@/lib/stack/types";

const LOCAL = { "content-type": "application/json", "x-scoop-local": "1" };
const DISMISS_KEY = "scoop.dismissStackStart";

type Status = {
  catalogReady: boolean;
  summary: string;
  rows: StackStatusRow[];
};

export function StackStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offers, setOffers] = useState<StartOffer[]>([]);
  const [fulcrumNote, setFulcrumNote] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/stack/status", {
        cache: "no-store",
        headers: { "x-scoop-local": "1" },
      });
      const json = (await res.json()) as Status & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "stack status failed");
      setStatus(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (window.sessionStorage.getItem(DISMISS_KEY) === "1") {
      setDismissed(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/stack/diagnose", {
          cache: "no-store",
          headers: { "x-scoop-local": "1" },
        });
        const json = (await res.json()) as {
          diagnoses?: (StartOffer & { severity?: string; headline?: string })[];
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? "stack diagnose failed");
        if (cancelled) return;
        const diagnoses = json.diagnoses ?? [];
        setOffers(localServicesToStart(diagnoses));
        const fulcrum = diagnoses.find((row) => row.id === "core-fulcrum");
        setFulcrumNote(
          fulcrum && !fulcrum.canStart && fulcrum.severity === "action" ? (fulcrum.headline ?? null) : null
        );
      } catch {
        if (!cancelled) setOffers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startServices = async () => {
    setStarting(true);
    setStartError(null);
    try {
      for (const offer of offers) {
        const res = await fetch("/api/stack/service", {
          method: "POST",
          headers: LOCAL,
          body: JSON.stringify({ id: offer.id, action: "start" }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? `could not start ${offer.label}`);
      }
      setOffers([]);
      await load();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const names = offers.map((offer) => offer.label);
  const offerText =
    names.length === 0
      ? ""
      : names.length === 1
        ? `${names[0]} is configured and stopped.`
        : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are configured and stopped.`;

  return (
    <section className="scoop-panel">
      <div className="section-head">
        <h3>Stack</h3>
        <Link href="/stack" className="scoop-btn ghost">
          Paths and services
        </Link>
      </div>
      {error ? <p className="banner bad">{error}</p> : null}
      {!dismissed && offers.length > 0 ? (
        <div className="banner warn">
          <p>
            {offerText} Start {names.length === 1 ? "it" : "them"} on this PC?
          </p>
          {fulcrumNote ? <p>{fulcrumNote}</p> : null}
          <div className="dash-actions">
            <button type="button" className="scoop-btn" onClick={() => void startServices()} disabled={starting}>
              {starting ? "Starting…" : "Start"}
            </button>
            <button
              type="button"
              className="scoop-btn ghost"
              onClick={() => {
                window.sessionStorage.setItem(DISMISS_KEY, "1");
                setDismissed(true);
              }}
              disabled={starting}
            >
              Not now
            </button>
          </div>
          {startError ? <p>{startError}</p> : null}
        </div>
      ) : null}
      {status ? (
        <p className={status.catalogReady ? "banner ok" : "banner warn"}>{status.summary}</p>
      ) : !error ? (
        <p className="muted">Checking Core and Knots…</p>
      ) : null}
      {status ? (
        <ul className="stack-rows">
          {status.rows.map((row) => (
            <li key={row.id} className="stack-row">
              <span className={`stack-state is-${row.state}`}>{row.state}</span>
              <span>
                <strong>{row.label}</strong>
                <span className="muted"> {row.detail}</span>
                {row.height != null ? (
                  <span className="muted"> · height {row.height.toLocaleString()}</span>
                ) : null}
              </span>
              <span className="muted stack-endpoint">{row.endpoint || "—"}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
