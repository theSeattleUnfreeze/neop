"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { StackStatusRow } from "@/lib/stack/types";

type Status = {
  catalogReady: boolean;
  summary: string;
  rows: StackStatusRow[];
};

export function StackStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section className="scoop-panel">
      <div className="section-head">
        <h3>Stack</h3>
        <Link href="/stack" className="scoop-btn ghost">
          Paths and services
        </Link>
      </div>
      {error ? <p className="banner bad">{error}</p> : null}
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
