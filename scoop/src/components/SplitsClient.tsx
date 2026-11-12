"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SplitForkList } from "@/components/SplitFork";
import type { CoinFork } from "@/lib/fork/forks";

export function SplitsClient() {
  const params = useSearchParams();
  const accountRaw = params.get("account");
  const accountId = accountRaw != null && /^\d+$/.test(accountRaw) ? accountRaw : null;
  const [forks, setForks] = useState<CoinFork[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const query = accountId ? `?accountId=${accountId}` : "";
    const res = await fetch(`/api/organizer/splits${query}`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "failed to load splits");
      setLoaded(true);
      return;
    }
    setForks(Array.isArray(json.forks) ? json.forks : []);
    setLoaded(true);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="scoop-stack">
      <section className="scoop-panel">
        <h2>Splits</h2>
        <p className="muted">
          History of coins spent differently on Core and on Knots. Each column lists the addresses
          that flavor paid. A wallet name means Scoop already watches that address.
          {accountId ? (
            <>
              {" "}
              Showing one wallet. <Link href="/splits">Show every wallet</Link>.
            </>
          ) : null}
        </p>
        {error ? <p className="banner bad">{error}</p> : null}
        {loaded ? <SplitForkList forks={forks} /> : <p className="muted">Loading…</p>}
      </section>
    </div>
  );
}
