"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { inspectPsbt } from "@/lib/broadcast/inspectPsbt";
import { noteForOutpoint, type LabelRecord } from "@/lib/labels/bip329";
import { garnishUnsignedPsbt, nextWedge, wedgeCycleStart } from "@/lib/psbt/garnish";
import { chainLane, rdtsApplies, type SplitMethod } from "@/lib/split/method";
import { attachUnsigned, classifyUnsigned, garnishTargets, rowReady } from "@/lib/split/queue";
import { ConfirmRing } from "@/components/ConfirmRing";
import { DatacarrierAssist } from "@/components/DatacarrierAssist";
import { WalletIntake } from "@/components/WalletIntake";

const LOCAL = { "content-type": "application/json", "x-scoop-local": "1" };

type StepId = "method" | "files" | "garnish" | "broadcast" | "watch";

const STEPS: { id: StepId; label: string }[] = [
  { id: "method", label: "Method" },
  { id: "files", label: "Files" },
  { id: "garnish", label: "Garnish" },
  { id: "broadcast", label: "Broadcast" },
  { id: "watch", label: "Watch" },
];

type Coin = {
  key: string;
  txid: string;
  vout: number;
  address: string;
  sats: string;
  receivedHeight: number | null;
  receivedAt: string | null;
};

type Held = { name: string; bytes: Uint8Array };

type SignedHeld = {
  name: string;
  base64: string;
  txid: string | null;
  flavor: "core" | "knots" | null;
  outpoints: { txid: string; vout: number }[];
};

type PreviewRow = {
  name: string;
  flavor: "core" | "knots" | null;
  why: string;
  inputCount: number;
  needText: string;
};

type WatchRow = { name: string; status: string; confirmations?: number };

type ReadyFile = { name: string; bytes: Uint8Array; garnished: boolean; error?: string; feeBefore?: number; feeAfter?: number };

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

function satsOf(row: { core?: { status?: string; valueSats?: string | number | null }; knots?: { status?: string; valueSats?: string | number | null } }): bigint {
  const core = row.core?.status === "unspent" ? BigInt(row.core.valueSats ?? 0) : 0n;
  const knots = row.knots?.status === "unspent" ? BigInt(row.knots.valueSats ?? 0) : 0n;
  return core > knots ? core : knots;
}

function downloadName(name: string, garnished: boolean): string {
  if (!garnished) return name;
  return name.replace(/\.psbt$/i, "") + ".garnish.psbt";
}

function saveBytes(name: string, bytes: Uint8Array) {
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function SplitFlow() {
  const params = useSearchParams();
  const accountId = params.get("account");
  const [accounts, setAccounts] = useState<{ id: number; label: string }[]>([]);
  const [coins, setCoins] = useState<Coin[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [method, setMethod] = useState<SplitMethod>("core-garnish");
  const [step, setStep] = useState<StepId>("method");
  const [slots, setSlots] = useState<Record<string, Held[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [corePick, setCorePick] = useState<Record<string, string>>({});
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [rdts, setRdts] = useState<string[]>([]);
  const [readyFiles, setReadyFiles] = useState<ReadyFile[]>([]);
  const [signed, setSigned] = useState<SignedHeld[]>([]);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [pairOk, setPairOk] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [coreAccepted, setCoreAccepted] = useState(false);
  const [knotsSent, setKnotsSent] = useState(false);
  const [watching, setWatching] = useState(false);
  const [watchRows, setWatchRows] = useState<WatchRow[]>([]);
  const [watchReason, setWatchReason] = useState<string | null>(null);
  const [reorgSeen, setReorgSeen] = useState(true);
  const knotsLock = useRef(false);
  const sendingRef = useRef(false);
  const signedRef = useRef(signed);
  const previewRef = useRef(previewRows);
  signedRef.current = signed;
  previewRef.current = previewRows;

  const listed = useMemo(() => new Set(coins.map((coin) => coin.key)), [coins]);

  useEffect(() => {
    void fetch("/api/broadcast/rdts", { headers: { "x-scoop-local": "1" } })
      .then((res) => res.json())
      .then((json: { reasons?: string[] }) => setRdts(json.reasons ?? []))
      .catch(() => setRdts([]));
  }, []);

  useEffect(() => {
    if (accountId) return;
    void fetch("/api/organizer/accounts")
      .then((res) => res.json())
      .then((json: { accounts?: { id: number; label: string }[] }) => setAccounts(json.accounts ?? []))
      .catch(() => setAccounts([]));
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    let stop = false;
    const load = async () => {
      setLoadError(null);
      const res = await fetch(`/api/organizer/accounts/${accountId}`);
      const json = await res.json();
      if (!res.ok) {
        if (!stop) setLoadError(json.error ?? "Could not load that wallet.");
        return;
      }
      const rows = (Array.isArray(json.rows) ? json.rows : []) as {
        txid?: string;
        vout?: number;
        replayRisk?: boolean;
        address?: string | null;
        receivedHeight?: number | null;
        receivedAt?: string | null;
        core?: { status?: string; valueSats?: string | number | null };
        knots?: { status?: string; valueSats?: string | number | null };
      }[];
      const next = rows
        .filter((row) => row.replayRisk && typeof row.txid === "string" && typeof row.vout === "number")
        .map((row) => ({
          key: `${row.txid!.toLowerCase()}:${row.vout}`,
          txid: row.txid!,
          vout: row.vout!,
          address: row.address ?? "",
          sats: satsOf(row).toString(),
          receivedHeight: row.receivedHeight ?? null,
          receivedAt: row.receivedAt ?? null,
        }))
        .sort((a, b) => (BigInt(a.sats) < BigInt(b.sats) ? 1 : BigInt(a.sats) > BigInt(b.sats) ? -1 : 0));
      let records: LabelRecord[] = [];
      try {
        const labels = await fetch(`/api/organizer/accounts/${accountId}/labels`, { headers: { "x-scoop-local": "1" } });
        if (labels.ok) {
          const body = (await labels.json()) as { labels?: LabelRecord[] };
          records = body.labels ?? [];
        }
      } catch {
        records = [];
      }
      if (stop) return;
      setCoins(next);
      setNotes(Object.fromEntries(next.map((coin) => [coin.key, noteForOutpoint(records, coin.txid, coin.vout)])));
    };
    void load();
    return () => {
      stop = true;
    };
  }, [accountId]);

  const filesReady = coins.length > 0 && coins.every((coin) => {
    const files = slots[coin.key] ?? [];
    return rowReady(method, files.length) && garnishTargets(method, files, corePick[coin.key] ?? null).ok;
  });

  const takeUnsigned = async (list: FileList | null) => {
    if (!list?.length) return;
    setUnmatched([]);
    let next = slots;
    const reasons: string[] = [];
    for (const file of Array.from(list)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let seen;
      try {
        seen = inspectPsbt(file.name, bytes);
      } catch {
        reasons.push(`${file.name} is not a PSBT.`);
        continue;
      }
      const classified = classifyUnsigned(
        { name: file.name, inputCount: seen.inputCount, outpoints: seen.outpoints, signed: seen.txid !== null },
        listed
      );
      if (!classified.ok) {
        reasons.push(classified.reason);
        continue;
      }
      const attached = attachUnsigned(method, next, classified.outpoint, { name: file.name, bytes });
      next = attached.slots;
      if (attached.reason) reasons.push(attached.reason);
    }
    setSlots(next);
    setUnmatched(reasons);
  };

  const buildReady = useCallback(() => {
    let index = wedgeCycleStart();
    const built: ReadyFile[] = [];
    for (const coin of coins) {
      const files = slots[coin.key] ?? [];
      const targets = garnishTargets(method, files, corePick[coin.key] ?? null);
      for (const file of files) {
        const garnishThis = targets.names.includes(file.name);
        if (!garnishThis) {
          built.push({ name: file.name, bytes: file.bytes, garnished: false });
          continue;
        }
        try {
          const result = garnishUnsignedPsbt(file.bytes, nextWedge(index));
          index += 1;
          built.push({
            name: downloadName(file.name, true),
            bytes: Uint8Array.from(atob(result.psbtBase64), (char) => char.charCodeAt(0)),
            garnished: true,
            feeBefore: result.feeSatsBefore,
            feeAfter: result.feeSatsAfter,
          });
        } catch (err) {
          built.push({ name: file.name, bytes: file.bytes, garnished: false, error: err instanceof Error ? err.message : "Could not garnish that file." });
        }
      }
    }
    setReadyFiles(built);
  }, [coins, corePick, method, slots]);

  useEffect(() => {
    if (step === "garnish") buildReady();
  }, [step, buildReady]);

  const loadSigned = async (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    setNotice(null);
    const next: { name: string; base64: string; txid: string | null; outpoints: { txid: string; vout: number }[] }[] = [];
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
    const res = await fetch("/api/broadcast/preview", {
      method: "POST",
      headers: LOCAL,
      body: JSON.stringify({
        method,
        queue: coins.map((coin) => coin.key),
        files: next.map((file) => ({ name: file.name, base64: file.base64 })),
      }),
    });
    const json = (await res.json().catch(() => null)) as {
      rows?: PreviewRow[];
      problems?: string[];
      pairOk?: boolean;
      rdts?: { reasons?: string[] };
      error?: string;
    } | null;
    if (!res.ok || !json || json.error) {
      setSigned([]);
      setPreviewRows([]);
      setPairOk(false);
      setError(json?.error ?? "Scoop could not read these files.");
      return;
    }
    const byName = new Map(next.map((file) => [file.name, file]));
    setSigned(
      (json.rows ?? []).map((row) => ({
        name: row.name,
        base64: byName.get(row.name)?.base64 ?? "",
        txid: byName.get(row.name)?.txid ?? null,
        flavor: row.flavor,
        outpoints: byName.get(row.name)?.outpoints ?? [],
      }))
    );
    setPreviewRows(json.rows ?? []);
    setProblems(json.problems ?? []);
    setPairOk(json.pairOk === true);
    setChecked({});
    if (json.rdts?.reasons?.length) setRdts(json.rdts.reasons);
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
          method,
          queue: coins.map((coin) => coin.key),
          phase,
          checked: previewRef.current.filter((row) => checked[row.name]).map((row) => row.name),
          files: signedRef.current.map((file) => ({ name: file.name, base64: file.base64 })),
        }),
      });
      const json = (await res.json().catch(() => null)) as { sent?: number; stopped?: string; error?: string } | null;
      if (json?.stopped) {
        setNotice(json.stopped);
        if ((json.sent ?? 0) > 0 && phase === "core") {
          setCoreAccepted(true);
          setWatching(true);
          setStep("watch");
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
        setStep("watch");
      } else {
        setKnotsSent(true);
        setWatching(true);
        setStep("watch");
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
      const currentRows = previewRef.current;
      const current = signedRef.current;
      const byName = new Map(current.map((file) => [file.name, file]));
      const corePoints = currentRows.filter((row) => row.flavor === "core").flatMap((row) => byName.get(row.name)?.outpoints ?? []);
      const watchBody = currentRows.flatMap((row) => {
        const file = byName.get(row.name);
        if (!file?.txid || (row.flavor !== "core" && row.flavor !== "knots")) return [];
        return [{ name: row.name, txid: file.txid, flavor: row.flavor, points: file.outpoints }];
      });
      const res = await fetch("/api/broadcast/watch", {
        method: "POST",
        headers: LOCAL,
        body: JSON.stringify({ method, points: corePoints, rows: watchBody }),
      });
      const json = (await res.json().catch(() => null)) as {
        phase?: string;
        reason?: string;
        rows?: WatchRow[];
        error?: string;
      } | null;
      if (stop || !json) return;
      if (json.error) {
        setWatchReason(json.error);
        return;
      }
      setWatchReason(json.reason ?? null);
      setWatchRows(json.rows ?? []);
      if ((json.rows ?? []).some((row) => row.status === "reorged")) setReorgSeen(false);
      if (method === "drain" && json.phase === "send-knots" && coreAccepted && !knotsSent && !knotsLock.current) {
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
  }, [watching, coreAccepted, knotsSent, method]);

  const checkedCount = previewRows.filter((row) => checked[row.name]).length;
  const coreCount = previewRows.filter((row) => row.flavor === "core").length;
  const canSend = pairOk && previewRows.length > 0 && checkedCount === previewRows.length && !sending && !coreAccepted && !knotsSent;

  if (!accountId) {
    return (
      <div className="scoop-stack">
        <section className="scoop-panel">
          <h2>Split</h2>
          <p>Choose the wallet whose coins are still unspent on both chains.</p>
          {accounts.length ? (
            <ul className="broadcast-rows">
              {accounts.map((account) => (
                <li key={account.id}>
                  <Link href={`/split?account=${account.id}`}>{account.label || "Untitled wallet"}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              <Link href="/wallets">Add a wallet</Link> first.
            </p>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="scoop-stack">
      <ol className="split-steps">
        {STEPS.map((item, index) => (
          <li key={item.id} className={item.id === step ? "current" : undefined}>
            <button type="button" className="scoop-btn ghost" onClick={() => setStep(item.id)}>
              {index + 1}. {item.label}
            </button>
          </li>
        ))}
      </ol>
      {loadError ? <p className="banner bad">{loadError}</p> : null}

      {step === "method" ? (
        <section className="scoop-panel">
          <h2>How should these coins split?</h2>
          <p>
            Core garnish and Drain depend on Knots rejecting a long OP_RETURN through 2027-09-01. Unified sighash does
            not.
          </p>
          {rdtsApplies(method) ? rdts.map((reason) => (
            <p key={reason} className="banner warn">{reason}</p>
          )) : null}
          <div className="method-picker">
            <button type="button" className={`scoop-btn${method === "core-garnish" ? "" : " ghost"}`} onClick={() => { setMethod("core-garnish"); setSlots({}); setCorePick({}); }}>
              Core garnish
            </button>
            <button type="button" className={`scoop-btn${method === "unified-sighash" ? "" : " ghost"}`} onClick={() => { setMethod("unified-sighash"); setSlots({}); setCorePick({}); }}>
              Unified sighash
            </button>
            <button type="button" className={`scoop-btn${method === "drain" ? "" : " ghost"}`} onClick={() => { setMethod("drain"); setSlots({}); setCorePick({}); }}>
              Drain
            </button>
          </div>
          <p>
            {method === "core-garnish"
              ? "Send the Core coin to another wallet. The Knots coin stays in the wallet you are watching. Scoop adds the OP_RETURN before you sign."
              : method === "unified-sighash"
                ? "Send the Knots coin to another wallet and sign it in Shrike with unified sighash. The Core coin stays. Scoop does not add an OP_RETURN."
                : "Move both coins. Each coin needs a Core file and a Knots file. Scoop garnishes the Core file. Knots is sent only after that Core input is in a block."}
          </p>
          <button type="button" className="scoop-btn" onClick={() => setStep("files")}>
            Continue
          </button>
        </section>
      ) : null}

      {step === "files" ? (
        <section className="scoop-panel">
          <h2>Unsigned transactions</h2>
          <p>
            Build one unsigned PSBT per coin{method === "drain" ? ", two for a drain," : ""} with one payment and no
            change. Name the file so you can find it. Drop the files anywhere on this page. Scoop matches each one to
            its coin.
          </p>
          {method !== "unified-sighash" ? (
            <p>
              Use a normal fee rate on a file that will be garnished. The OP_RETURN adds weight and the extra fee comes
              out of that payment, so the signed fee is higher and the payment has to stay above dust.
            </p>
          ) : (
            <p>Unified sighash files are not garnished, so the fee stays as you built it.</p>
          )}
          <label
            className="field label-drop"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void takeUnsigned(event.dataTransfer.files);
            }}
          >
            <span>Drop unsigned PSBTs</span>
            <input type="file" multiple onChange={(event) => void takeUnsigned(event.target.files)} />
          </label>
          {unmatched.map((reason) => (
            <p key={reason} className="banner bad">{reason}</p>
          ))}
          {coins.length ? (
            <table className="split-table">
              <thead>
                <tr>
                  <th>Amount</th>
                  <th>Address</th>
                  <th>Outpoint</th>
                  <th>Received</th>
                  <th>Label</th>
                  <th>Files</th>
                </tr>
              </thead>
              <tbody>
                {coins.map((coin) => {
                  const files = slots[coin.key] ?? [];
                  const ready = rowReady(method, files.length);
                  return (
                    <tr key={coin.key}>
                      <td>{BigInt(coin.sats).toLocaleString()} sats</td>
                      <td className="mono">{coin.address || "—"}</td>
                      <td className="mono">{coin.txid.slice(0, 8)}…:{coin.vout}</td>
                      <td>{coin.receivedAt ? new Date(coin.receivedAt).toLocaleString() : coin.receivedHeight ?? "—"}</td>
                      <td>
                        <input
                          value={notes[coin.key] ?? ""}
                          aria-label="Label"
                          onChange={(event) => setNotes((prev) => ({ ...prev, [coin.key]: event.target.value }))}
                        />
                      </td>
                      <td>
                        {ready ? <span className="banner ok">Ready</span> : <span className="muted">Waiting</span>}
                        <ul>
                          {files.map((file) => (
                            <li key={file.name}>
                              <span className="mono">{file.name}</span>
                              {method === "drain" ? (
                                <label>
                                  <input
                                    type="radio"
                                    name={`core-${coin.key}`}
                                    checked={corePick[coin.key] === file.name}
                                    onChange={() => setCorePick((prev) => ({ ...prev, [coin.key]: file.name }))}
                                  />
                                  Core spend
                                </label>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p>This wallet has no coins that are still unspent on both chains.</p>
          )}
          <p>Add the wallet that will receive the coins, if Scoop is not watching it yet. You can skip this.</p>
          <button type="button" className="scoop-btn ghost" onClick={() => setAdding(true)}>
            Add destination wallet
          </button>
          <WalletIntake
            hasWallets
            open={adding}
            onOpen={() => setAdding(true)}
            onClose={() => setAdding(false)}
            onCreated={async () => setAdding(false)}
          />
          <button type="button" className="scoop-btn" disabled={!filesReady} onClick={() => setStep("garnish")}>
            Continue
          </button>
        </section>
      ) : null}

      {step === "garnish" ? (
        <section className="scoop-panel">
          <h2>{method === "unified-sighash" ? "Sign in Shrike" : "Garnish"}</h2>
          {rdtsApplies(method) ? rdts.map((reason) => (
            <p key={reason} className="banner warn">{reason}</p>
          )) : null}
          {method === "unified-sighash" ? (
            <p>These files do not get an OP_RETURN. Sign each one in Shrike with unified sighash, then come back to broadcast.</p>
          ) : (
            <>
              <p>Download the files and sign them on the device. A signature commits to the outputs, so sign only after the garnish is in the Core file.</p>
              <DatacarrierAssist />
            </>
          )}
          {method === "drain" ? <p>The Knots file is unchanged. Sign it as SIGHASH_ALL, with no long OP_RETURN.</p> : null}
          <ul className="broadcast-rows">
            {readyFiles.map((file) => (
              <li key={file.name}>
                <strong className="mono">{file.name}</strong>
                {file.error ? <p className="banner bad">{file.error}</p> : null}
                {file.garnished && file.feeBefore != null ? (
                  <p className="muted">Fee {file.feeBefore.toLocaleString()} sats, then {file.feeAfter?.toLocaleString()} sats.</p>
                ) : null}
                <button type="button" className="scoop-btn ghost" onClick={() => saveBytes(file.name, file.bytes)}>
                  Download
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="scoop-btn"
            onClick={() => {
              for (const file of readyFiles) {
                if (!file.error) saveBytes(file.name, file.bytes);
              }
            }}
          >
            Download all
          </button>
          <button type="button" className="scoop-btn" disabled={readyFiles.some((file) => file.error)} onClick={() => setStep("broadcast")}>
            Continue
          </button>
        </section>
      ) : null}

      {step === "broadcast" ? (
        <section className="scoop-panel">
          <h2>Broadcast</h2>
          <p className="banner warn">A Core transaction that the node accepts cannot be taken back.</p>
          {rdtsApplies(method) ? rdts.map((reason) => (
            <p key={reason} className="banner warn">{reason}</p>
          )) : null}
          <p>Drop the signed files. Scoop checks them against the coins from the file step.</p>
          <label className="field">
            <span>Signed PSBTs</span>
            <input type="file" multiple onChange={(event) => void loadSigned(event.target.files)} />
          </label>
          {error ? <p className="banner bad">{error}</p> : null}
          {notice ? <p className="banner ok">{notice}</p> : null}
          {previewRows.length ? (
            <ul className="broadcast-rows">
              {previewRows.map((row) => (
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
                    {row.flavor === "core" ? "Core" : row.flavor === "knots" ? "Knots" : "Unlabeled"}. {row.why}
                  </p>
                  <p className="muted">{row.needText}</p>
                </li>
              ))}
            </ul>
          ) : null}
          {problems.map((problem) => (
            <p key={problem} className="banner bad">{problem}</p>
          ))}
          <button
            type="button"
            className="scoop-btn"
            disabled={!canSend}
            onClick={() => void send(coreCount > 0 ? "core" : "knots")}
          >
            {sending ? "Sending…" : coreCount > 0 ? "Send Core wave" : "Send Knots wave"}
          </button>
        </section>
      ) : null}

      {step === "watch" ? (
        <section className="scoop-panel" id="watch">
          <h2>Watch</h2>
          <p>{watchReason ?? (watching ? "Asking the stack." : "Send a wave to start watching.")}</p>
          {!reorgSeen ? (
            <p className="banner bad">
              A block was replaced. This transaction is not in the chain it was in.{" "}
              <button type="button" className="scoop-btn ghost" onClick={() => setReorgSeen(true)}>
                Dismiss
              </button>
            </p>
          ) : null}
          {coins.map((coin) => (
            <article key={coin.key} className="split-watch">
              <h3 className="mono">{coin.txid.slice(0, 8)}…:{coin.vout}</h3>
              <div className="split-lanes">
                <div>
                  <strong>Core</strong>
                  <p>{chainLane(method, "core") === "staying" ? "Stays in this wallet." : "Moving."}</p>
                  {chainLane(method, "core") === "moving"
                    ? watchRows
                        .filter((row) => {
                          const preview = previewRows.find((item) => item.name === row.name);
                          const file = signed.find((item) => item.name === row.name);
                          return preview?.flavor === "core" && file?.outpoints.some((point) => `${point.txid.toLowerCase()}:${point.vout}` === coin.key);
                        })
                        .map((row) => <ConfirmRing key={row.name} status={row.status} confirmations={row.confirmations ?? 0} />)
                    : null}
                </div>
                <div>
                  <strong>Knots</strong>
                  <p>{chainLane(method, "knots") === "staying" ? "Stays in this wallet." : "Moving."}</p>
                  {chainLane(method, "knots") === "moving"
                    ? watchRows
                        .filter((row) => {
                          const preview = previewRows.find((item) => item.name === row.name);
                          const file = signed.find((item) => item.name === row.name);
                          return preview?.flavor === "knots" && file?.outpoints.some((point) => `${point.txid.toLowerCase()}:${point.vout}` === coin.key);
                        })
                        .map((row) => <ConfirmRing key={row.name} status={row.status} confirmations={row.confirmations ?? 0} />)
                    : null}
                </div>
              </div>
            </article>
          ))}
          {notice ? <p className="banner ok">{notice}</p> : null}
          {error ? <p className="banner bad">{error}</p> : null}
          <p className="muted">This page holds the files in the browser. A refresh means dropping them again.</p>
        </section>
      ) : null}
    </div>
  );
}
