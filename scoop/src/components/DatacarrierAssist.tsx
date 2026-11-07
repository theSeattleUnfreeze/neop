"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";

const LOCAL = { "x-scoop-local": "1" };

type Assist = {
  raise: string;
  revert: string;
  configFile: string | null;
  restart: string | null;
  shell: string;
};

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* The page can still select the line into the clipboard the older way. */
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "true");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.focus();
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("copy failed");
}

export function DatacarrierAssist() {
  const [assist, setAssist] = useState<Assist | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const raiseRef = useRef<HTMLInputElement>(null);
  const restartRef = useRef<HTMLInputElement>(null);
  const revertRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetch("/api/stack/datacarrier", { headers: LOCAL })
      .then((res) => res.json())
      .then((json: Assist) => {
        if (json?.raise && json?.revert) setAssist(json);
      })
      .catch(() => setAssist(null))
      .finally(() => setLoaded(true));
  }, []);

  const copy = async (id: string, text: string, field: RefObject<HTMLInputElement | null>) => {
    try {
      await copyText(text);
      setCopied(id);
      window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 2000);
    } catch {
      setCopied(`${id}-failed`);
      field.current?.focus();
      field.current?.select();
    }
  };

  const reveal = async () => {
    if (!assist?.configFile) return;
    setRevealError(null);
    const res = await fetch("/api/stack/reveal", {
      method: "POST",
      headers: { "content-type": "application/json", "x-scoop-local": "1" },
      body: JSON.stringify({ path: assist.configFile }),
    });
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) setRevealError(json?.error ?? "Could not open the config file.");
  };

  const raise = assist?.raise ?? "datacarriersize=120";
  const revert = assist?.revert ?? "datacarriersize=83";

  return (
    <div className="banner warn">
      <p>
        Bitcoin Core 28 keeps an 83-byte datacarrier limit unless <span className="mono">datacarriersize</span> is at
        least 120. A garnish script is at most 120 bytes, so this node will drop it. Core reads that line when it
        starts. There is no RPC to raise it for one send and put it back afterward. Leave 120 in place until the Core
        transactions are in a block. A restart before then drops the unconfirmed garnish. Leave Core running while
        Fulcrum is still downloading blocks.
      </p>
      <p>Paste this on its own line in bitcoin.conf.</p>
      <div className="datacarrier-line">
        <input ref={raiseRef} className="mono" readOnly spellCheck={false} value={raise} aria-label="Raise the datacarrier limit" />
        <button type="button" className="scoop-btn ghost" onClick={() => void copy("raise", raise, raiseRef)}>
          {copied === "raise" ? "Copied" : copied === "raise-failed" ? "Selected" : "Copy"}
        </button>
      </div>
      {!loaded ? (
        <p className="muted">Looking up bitcoin.conf.</p>
      ) : assist?.configFile ? (
        <p>
          <button type="button" className="scoop-btn" onClick={() => void reveal()}>
            Show bitcoin.conf
          </button>{" "}
          <span className="mono stack-path">{assist.configFile}</span>
        </p>
      ) : (
        <p>
          Scoop does not know which bitcoin.conf this Core node uses.{" "}
          <Link href="/stack?service=core-node#datacarrier">Set the config file on the Stack page</Link>, then this
          button can open it.
        </p>
      )}
      {revealError ? <p className="banner bad">{revealError}</p> : null}
      {loaded && assist?.restart ? (
        <>
          <p>After the file is saved, paste this into {assist.shell} to restart Core so it reads the new line.</p>
          <div className="datacarrier-line">
            <input
              ref={restartRef}
              className="mono"
              readOnly
              spellCheck={false}
              value={assist.restart}
              aria-label="Restart Core"
            />
            <button type="button" className="scoop-btn ghost" onClick={() => void copy("restart", assist.restart ?? "", restartRef)}>
              {copied === "restart" ? "Copied" : copied === "restart-failed" ? "Selected" : "Copy"}
            </button>
          </div>
        </>
      ) : loaded ? (
        <p>
          Set the Core binary and data directory on the Stack page and Scoop can fill in the restart command. Until
          then, stop Core and start it again the same way it is running now.
        </p>
      ) : null}
      <p>When those Core transactions are in a block, put the limit back, then restart Core again.</p>
      <div className="datacarrier-line">
        <input ref={revertRef} className="mono" readOnly spellCheck={false} value={revert} aria-label="Restore the datacarrier limit" />
        <button type="button" className="scoop-btn ghost" onClick={() => void copy("revert", revert, revertRef)}>
          {copied === "revert" ? "Copied" : copied === "revert-failed" ? "Selected" : "Copy"}
        </button>
      </div>
    </div>
  );
}
