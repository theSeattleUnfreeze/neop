"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { garnishUnsignedPsbt, nextWedge, wedgeCycleStart, type GarnishResult, type PayloadKind } from "@/lib/psbt/garnish";
import { garnishPageOrder } from "@/lib/psbt/garnishPages";
import { inspectPsbt } from "@/lib/broadcast/inspectPsbt";
import { SplitSteps } from "@/components/SplitSteps";
import { WalletIntake } from "@/components/WalletIntake";
import { DatacarrierAssist } from "@/components/DatacarrierAssist";

const KIND_LABEL: Record<PayloadKind, string> = {
  bytes: "raw bytes",
  text: "text",
  hex: "hex",
  pushes: "several pushes",
};

/** One Download all pass saves at most this many files, then turns the page. */
const PAGE_SIZE = 10;
const DOWNLOAD_GAP_MS = 400;

type Item = {
  id: string;
  name: string;
  error?: string;
  result?: GarnishResult;
  downloaded: boolean;
};

function downloadName(name: string): string {
  return name.replace(/\.psbt$/i, "") + ".garnish.psbt";
}

function savePsbt(item: Item): void {
  if (!item.result) return;
  const bin = Uint8Array.from(atob(item.result.psbtBase64), (c) => c.charCodeAt(0));
  const blob = new Blob([bin], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = downloadName(item.name);
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

const LOCAL = { "content-type": "application/json", "x-scoop-local": "1" };

export function GarnishDrop() {
  const [items, setItems] = useState<Item[]>([]);
  const [page, setPage] = useState(0);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [unknownInputs, setUnknownInputs] = useState(0);
  const [adding, setAdding] = useState(false);
  const [rdts, setRdts] = useState<string[]>([]);
  const addresses = useRef<string[]>([]);
  const unreadable = useRef(0);
  const downloadedIds = useRef(new Set<string>());
  const runLock = useRef(false);

  const refreshCoverage = async () => {
    if (addresses.current.length === 0 && unreadable.current === 0) {
      setUnknownInputs(0);
      return;
    }
    const res = await fetch("/api/garnish/known", {
      method: "POST",
      headers: LOCAL,
      body: JSON.stringify({ addresses: addresses.current }),
    });
    const json = (await res.json().catch(() => null)) as { unknown?: number } | null;
    if (!res.ok || !json) return;
    setUnknownInputs((json.unknown ?? 0) + unreadable.current);
  };

  useEffect(() => {
    void fetch("/api/broadcast/rdts", { headers: { "x-scoop-local": "1" } })
      .then((res) => res.json())
      .then((json: { reasons?: string[] }) => setRdts(json.reasons ?? []))
      .catch(() => setRdts([]));
  }, []);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const next: Item[] = [];
    const found: string[] = [];
    let missed = 0;
    const start = wedgeCycleStart();
    for (const [index, file] of Array.from(files).entries()) {
      const id = `${index}:${file.name}:${start}`;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        try {
          const seen = inspectPsbt(file.name, bytes);
          if (seen.addresses.length === 0) missed += 1;
          else found.push(...seen.addresses);
        } catch {
          missed += 1;
        }
        next.push({
          id,
          name: file.name,
          downloaded: false,
          result: garnishUnsignedPsbt(bytes, nextWedge(start + index)),
        });
      } catch (err) {
        next.push({
          id,
          name: file.name,
          downloaded: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    downloadedIds.current = new Set();
    addresses.current = found;
    unreadable.current = missed;
    setPage(0);
    setItems(next);
    void refreshCoverage();
  };

  const markDownloaded = (id: string) => {
    downloadedIds.current.add(id);
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, downloaded: true } : item)));
  };

  const download = (item: Item) => {
    if (!item.result) return;
    savePsbt(item);
    markDownloaded(item.id);
  };

  const downloadAll = async () => {
    if (runLock.current) return;
    const ready = items.filter((item) => item.result);
    if (!ready.length || ready.every((item) => downloadedIds.current.has(item.id))) return;
    runLock.current = true;
    setDownloadingAll(true);
    try {
      const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
      for (const p of garnishPageOrder(page, pageCount)) {
        const slice = items.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
        const pending = slice.filter((item) => item.result && !downloadedIds.current.has(item.id));
        if (!pending.length) continue;
        setPage(p);
        for (const item of pending) {
          savePsbt(item);
          markDownloaded(item.id);
          await wait(DOWNLOAD_GAP_MS);
        }
      }
    } finally {
      runLock.current = false;
      setDownloadingAll(false);
    }
  };

  return (
    <div className="scoop-stack">
      <SplitSteps current="garnish" />
      <section className="scoop-panel">
        <h2>Core garnish</h2>
        <p className="muted">
          <Link href="/howto/garnish">Walkthrough: garnish Core PSBTs</Link>
          {" · "}
          <Link href="/split">Start from the coins that need a split</Link>
        </p>
        <p>
          Drop unsigned Core PSBTs from Sparrow, one coin in each. Scoop adds an OP_RETURN whose
          script is longer than 83 bytes, so Knots will not accept the transaction while the
          reduced-data rule holds (through 2027-09-01). The script stays within 84 to 120 bytes, and
          the files in one drop rotate through raw bytes, text, hex, and several pushes. Nothing is
          shared between them. Scoop does not join the files, does not sign, and does not broadcast.
        </p>
        <p>
          In Sparrow, spend the whole coin to one fresh address and save the unsigned PSBT. No
          change output. Sign on the Coldcards only after the garnish is in the file. A signature
          commits to the outputs, so a PSBT that is already signed cannot take an OP_RETURN. The
          Shrike transactions, with unified sighash, are the Knots half. Do not drop those here.
        </p>
        {rdts.map((reason) => (
          <p key={reason} className="banner warn">
            {reason}
          </p>
        ))}
        <DatacarrierAssist />
        <label className="field">
          <span>Unsigned PSBTs</span>
          <input
            type="file"
            multiple
            onChange={(e) => void onFiles(e.target.files)}
          />
        </label>
      </section>
      {unknownInputs > 0 ? (
        <section className="scoop-panel">
          <p className="banner warn">
            Some of these coins spend from a wallet Scoop is not watching. Add that wallet here, and this drop stays
            where it is.
          </p>
          <button type="button" className="scoop-btn" onClick={() => setAdding(true)}>
            Add wallet
          </button>
        </section>
      ) : null}
      <WalletIntake
        hasWallets
        open={adding}
        onOpen={() => setAdding(true)}
        onClose={() => setAdding(false)}
        onCreated={async () => {
          setAdding(false);
          await refreshCoverage();
        }}
      />
      {items.length ? (
        <GarnishResults
          items={items}
          page={page}
          downloadingAll={downloadingAll}
          onPage={setPage}
          onDownload={download}
          onDownloadAll={() => void downloadAll()}
        />
      ) : null}
      {items.some((item) => item.result) ? (
        <section className="scoop-panel">
          <p>
            Sign the garnished files on the Coldcards, along with the Knots files from Shrike. Then open Broadcast and
            check each one before it is sent.
          </p>
          <p>
            <Link href="/broadcast">Continue to Broadcast</Link>
          </p>
        </section>
      ) : null}
    </div>
  );
}

function GarnishResults({
  items,
  page,
  downloadingAll,
  onPage,
  onDownload,
  onDownloadAll,
}: {
  items: Item[];
  page: number;
  downloadingAll: boolean;
  onPage: (page: number) => void;
  onDownload: (item: Item) => void;
  onDownloadAll: () => void;
}) {
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = items.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const garnished = items.filter((item) => item.result);
  const downloaded = garnished.filter((item) => item.downloaded).length;
  const allSaved = garnished.length > 0 && downloaded === garnished.length;

  return (
    <section className="scoop-panel">
      <div className="section-head">
        <h3>Results</h3>
        <div className="garnish-actions">
          <p className="garnish-count">
            {downloaded} of {garnished.length} downloaded
          </p>
          <button
            type="button"
            className="scoop-btn"
            onClick={onDownloadAll}
            disabled={downloadingAll || garnished.length === 0 || allSaved}
          >
            {downloadingAll ? "Downloading…" : "Download all"}
          </button>
        </div>
      </div>
      <ul className="garnish-results">
        {visible.map((item) => (
          <li key={item.id}>
            <strong className="mono">{item.name}</strong>
            {item.error ? <p className="banner bad">{item.error}</p> : null}
            {item.result ? (
              <>
                <p>
                  One input. {KIND_LABEL[item.result.kind]}, {item.result.dataBytes} data bytes. OP_RETURN
                  script is {item.result.scriptPubKeyLength} bytes. Fee{" "}
                  {item.result.feeSatsBefore.toLocaleString()} → {item.result.feeSatsAfter.toLocaleString()} sats.
                </p>
                <div className="garnish-download">
                  <button
                    type="button"
                    className="scoop-btn"
                    onClick={() => onDownload(item)}
                    disabled={downloadingAll}
                  >
                    Download garnished PSBT
                  </button>
                  {item.downloaded ? (
                    <Check className="garnish-check" size={22} strokeWidth={2.75} aria-label="Downloaded" />
                  ) : null}
                </div>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {pageCount > 1 ? (
        <div className="garnish-pager">
          <button
            type="button"
            className="scoop-btn ghost"
            onClick={() => onPage(current - 1)}
            disabled={downloadingAll || current === 0}
          >
            Previous
          </button>
          <span>
            Page {current + 1} of {pageCount}
          </span>
          <button
            type="button"
            className="scoop-btn ghost"
            onClick={() => onPage(current + 1)}
            disabled={downloadingAll || current >= pageCount - 1}
          >
            Next
          </button>
        </div>
      ) : null}
    </section>
  );
}
