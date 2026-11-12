"use client";

import { useCallback, useEffect, useState } from "react";
import { SplitForkList } from "@/components/SplitFork";
import type { CoinFork } from "@/lib/fork/forks";

export function SplitsClient() {
  const [forks, setForks] = useState<CoinFork[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/organizer/splits");
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "failed to load splits");
      setLoaded(true);
      return;
    }
    setForks(Array.isArray(json.forks) ? json.forks : []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="scoop-stack">
      <section className="scoop-panel">
        <h2>Splits</h2>
        <p className="muted">
          A coin that was spent differently on Core and on Knots. Each column lists the addresses
          that flavor paid. A wallet name means Scoop already watches that address.
        </p>
        {error ? <p className="banner bad">{error}</p> : null}
        {loaded ? <SplitForkList forks={forks} /> : <p className="muted">Loading…</p>}
      </section>
    </div>
  );
}
