"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { inspectPsbt } from "@/lib/broadcast/inspectPsbt";
import { SplitSteps } from "@/components/SplitSteps";
import { WalletIntake } from "@/components/WalletIntake";

const LOCAL = { "content-type": "application/json", "x-scoop-local": "1" };

type PreviewRow = {
  name: string;
  flavor: "core" | "knots" | null;
  why: string;
  inputCount: number;
  needText: string;
};

type Held = {
  name: string;
  base64: string;
  txid: string | null;
  outpoints: { txid: string; vout: number }[];
};

type WatchRow = { name: string; status: string };

const STATUS: Record<string, string> = {
  mempool: "In the mempool",
  confirmed: "In a block",
  missing: "Not seen yet",
  conflict: "Another spend of this coin",
  reorged: "The block was reorganized",
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function pointsOf(outpoints: string[]): { txid: string; vout: number }[] {
  return outpoints.flatMap((point) => {
    const [txid, voutRaw] = point.split(":");
    const vout = Number(voutRaw);
    if (!txid || !Number.isInteger(vout)) return [];
    return [{ txid, vout }];
  });
}

export function BroadcastClient() {
  const [held, setHeld] = useState<Held[]>([]);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [pairOk, setPairOk] = useState(false);
  const [rdts, setRdts] = useState<string[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [coreAccepted, setCoreAccepted] = useState(false);
  const [knotsSent, setKnotsSent] = useState(false);
  const [watching, setWatching] = useState(false);
  const [watchRows, setWatchRows] = useState<WatchRow[]>([]);
  const [watchReason, setWatchReason] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const knotsLock = useRef(false);
  const sendingRef = useRef(false);
  const heldRef = useRef(held);
  const rowsRef = useRef(rows);
  heldRef.current = held;
  rowsRef.current = rows;

  const checkedCount = rows.filter((row) => checked[row.name]).length;
  const coreCount = rows.filter((row) => row.flavor === "core").length;
  const ready = pairOk && rows.length > 0 && checkedCount === rows.length && !sending && !coreAccepted && !knotsSent;

  const load = async (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    setNotice(null);
    setWatching(false);
    setCoreAccepted(false);
    setKnotsSent(false);
    knotsLock.current = false;
    const next: Held[] = [];
    for (const file of Array.from(list)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let txid: string | null = null;
      let outpoints: { txid: string; vout: number }[] = [];
      try {
        const seen = inspectPsbt(file.name, bytes);
        txid = seen.txid;
        outpoints = pointsOf(seen.outpoints);
      } catch {
        txid = null;
      }
      next.push({ name: file.name, base64: bytesToBase64(bytes), txid, outpoints });
    }
    setHeld(next);
    setChecked({});
    const res = await fetch("/api/broadcast/preview", {
      method: "POST",
      headers: LOCAL,
      body: JSON.stringify({ files: next.map((file) => ({ name: file.name, base64: file.base64 })) }),
    });
    const json = (await res.json().catch(() => null)) as {
      rows?: PreviewRow[];
      problems?: string[];
      pairOk?: boolean;
      rdts?: { reasons?: string[] };
      error?: string;
    } | null;
    if (!res.ok || !json || json.error) {
      setRows([]);
      setPairOk(false);
      setError(json?.error ?? "Scoop could not read these files.");
      return;
    }
    setRows(json.rows ?? []);
    setProblems(json.problems ?? []);
    setPairOk(json.pairOk === true);
    setRdts(json.rdts?.reasons ?? []);
  };

  const send = async (phase: "core" | "knots") => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/broadcast/send", {
        method: "POST",
        headers: LOCAL,
        body: JSON.stringify({
          phase,
          checked: rowsRef.current.filter((row) => checked[row.name]).map((row) => row.name),
          files: heldRef.current.map((file) => ({ name: file.name, base64: file.base64 })),
        }),
      });
      const json = (await res.json().catch(() => null)) as { sent?: number; stopped?: string; error?: string } | null;
      if (json?.stopped) {
        setNotice(json.stopped);
        if ((json.sent ?? 0) > 0 && phase === "core") {
          setCoreAccepted(true);
          setWatching(true);
        }
        if ((json.sent ?? 0) > 0 && phase === "knots") setKnotsSent(true);
        return;
      }
      if (!res.ok || !json || json.error) {
        setError(json?.error ?? "Send did not start.");
        return;
      }
      setNotice(phase === "core" ? "Core accepted this wave. It cannot be taken back." : "Knots accepted this wave.");
      if (phase === "core") {
        setCoreAccepted(true);
        setWatching(true);
      } else {
        setKnotsSent(true);
        setWatching(true);
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  useEffect(() => {
    if (!watching) return;
    let stop = false;
    const tick = async () => {
      const currentRows = rowsRef.current;
      const currentHeld = heldRef.current;
      const byName = new Map(currentHeld.map((file) => [file.name, file]));
      const corePoints = currentRows
        .filter((row) => row.flavor === "core")
        .flatMap((row) => byName.get(row.name)?.outpoints ?? []);
      const watchBody = currentRows.flatMap((row) => {
        const file = byName.get(row.name);
        if (!file?.txid || (row.flavor !== "core" && row.flavor !== "knots")) return [];
        return [{ name: row.name, txid: file.txid, flavor: row.flavor, points: file.outpoints }];
      });
      const res = await fetch("/api/broadcast/watch", {
        method: "POST",
        headers: LOCAL,
        body: JSON.stringify({ points: corePoints, rows: watchBody }),
      });
      const json = (await res.json().catch(() => null)) as {
        phase?: string;
        reason?: string;
        rows?: WatchRow[];
        rdts?: { reasons?: string[] };
        error?: string;
      } | null;
      if (stop || !json) return;
      if (json.error) {
        setWatchReason(json.error);
        return;
      }
      setWatchReason(json.reason ?? null);
      setWatchRows(json.rows ?? []);
      if (json.rdts?.reasons?.length) setRdts(json.rdts.reasons);
      if (json.phase === "send-knots" && coreAccepted && !knotsSent && !knotsLock.current) {
        knotsLock.current = true;
        void send("knots");
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 12_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [watching, coreAccepted, knotsSent]);

  return (
    <div className="scoop-stack">
      <SplitSteps current={watching ? "watch" : "broadcast"} />
      <section className="scoop-panel">
        <h2>Broadcast</h2>
        <p>
          Drop the signed files for one wave. Check every row before sending. Scoop sends the Core
          files first, watches those inputs leave the Core set, and only then sends the Knots files.
          A Knots file with no long OP_RETURN can still be replayed onto Core if it lands first.
        </p>
        <p className="banner warn">A Core transaction that the node accepts cannot be taken back.</p>
        {rdts.map((reason) => (
          <p key={reason} className="banner warn">
            {reason}
          </p>
        ))}
        <label className="field">
          <span>Signed PSBTs</span>
          <input type="file" multiple onChange={(event) => void load(event.target.files)} />
        </label>
        {error ? <p className="banner bad">{error}</p> : null}
        {notice ? <p className="banner ok">{notice}</p> : null}
      </section>
      {rows.length ? (
        <section className="scoop-panel">
          <h3>Check each transaction</h3>
          <ul className="broadcast-rows">
            {rows.map((row) => (
              <li key={row.name}>
                <label>
                  <input
                    type="checkbox"
                    checked={checked[row.name] === true}
                    onChange={(event) => setChecked((prev) => ({ ...prev, [row.name]: event.target.checked }))}
                    disabled={coreAccepted || knotsSent}
                  />
                  <strong className="mono">{row.name}</strong>
                </label>
                <p>
                  {row.flavor === "core" ? "Core" : row.flavor === "knots" ? "Knots" : "Unlabeled"}. {row.inputCount}{" "}
                  {row.inputCount === 1 ? "input" : "inputs"}. {row.why}
                </p>
                <p className="muted">{row.needText}</p>
              </li>
            ))}
          </ul>
          {problems.map((problem, index) => (
            <p key={`${index}:${problem}`} className="banner bad">
              {problem}
            </p>
          ))}
          <button
            type="button"
            className="scoop-btn"
            disabled={!ready}
            onClick={() => void send(coreCount > 0 ? "core" : "knots")}
          >
            {sending ? "Sending…" : coreCount > 0 ? "Send Core wave" : "Send Knots wave"}
          </button>
          {coreAccepted && !knotsSent && (error || (watchReason ?? "").includes("can be sent")) ? (
            <button
              type="button"
              className="scoop-btn ghost"
              disabled={sending}
              onClick={() => {
                knotsLock.current = false;
                void send("knots");
              }}
            >
              Try the Knots wave again
            </button>
          ) : null}
        </section>
      ) : null}
      {watching ? (
        <section className="scoop-panel" id="watch">
          <h3>Watch</h3>
          <p>{watchReason ?? "Asking the stack."}</p>
          <ul className="broadcast-rows">
            {watchRows.map((row) => (
              <li key={row.name}>
                <strong className="mono">{row.name}</strong>
                <p>{STATUS[row.status] ?? "Not seen yet"}</p>
              </li>
            ))}
          </ul>
          <p className="muted">
            This page holds the files in the browser. A refresh means dropping them again. Nothing is written to the
            database.
          </p>
          <p>Add the wallet that receives these coins if Scoop is not watching it yet.</p>
          <p>
            <Link href="/wallets">Open wallets</Link>
          </p>
          <WalletIntake
            hasWallets
            open={adding}
            onOpen={() => setAdding(true)}
            onClose={() => setAdding(false)}
            onCreated={async () => setAdding(false)}
          />
        </section>
      ) : null}
    </div>
  );
}
