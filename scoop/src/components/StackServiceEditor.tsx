"use client";

import { useEffect, useRef } from "react";
import type { StackService, StackServiceId, StackStatusRow } from "@/lib/stack/types";

export const STACK_FIELDS: Record<
  StackServiceId,
  { key: keyof StackService; label: string; reveal?: boolean; secret?: boolean }[]
> = {
  "core-node": [
    { key: "endpoint", label: "RPC URL" },
    { key: "binary", label: "bitcoind", reveal: true },
    { key: "datadir", label: "Data directory", reveal: true },
    { key: "configFile", label: "bitcoin.conf", reveal: true },
    { key: "cookieFile", label: "Cookie file", reveal: true },
  ],
  "core-fulcrum": [
    { key: "endpoint", label: "Electrum URL" },
    { key: "datadir", label: "Index directory", reveal: true },
    { key: "configFile", label: "fulcrum.conf", reveal: true },
    { key: "cookieFile", label: "Node cookie", reveal: true },
    { key: "containerName", label: "Docker container" },
    { key: "image", label: "Docker image" },
    { key: "publish", label: "Docker publish (ip:host port:container port)" },
  ],
  "knots-node": [
    { key: "endpoint", label: "LAN RPC URL" },
    { key: "rpcUser", label: "RPC user" },
    { key: "rpcPassword", label: "RPC password", secret: true },
  ],
  "knots-fulcrum": [{ key: "endpoint", label: "Electrum URL" }],
  "knots-link": [
    { key: "endpoint", label: "Local RPC URL" },
    { key: "startosHost", label: "StartOS host" },
    { key: "script", label: "Tunnel script", reveal: true },
    { key: "identityFile", label: "SSH identity", reveal: true },
    { key: "logFile", label: "Log", reveal: true },
  ],
};

type Props = {
  svc: StackService;
  row?: StackStatusRow;
  statusPending: boolean;
  busy: boolean;
  mode?: "page" | "dialog";
  onClose?: () => void;
  onPatch: (key: keyof StackService, value: string) => void;
  onReveal: (path: string) => void;
  onControl: (action: "start" | "stop") => void;
  onSave: () => void;
};

export function StackServiceEditor({
  svc,
  row,
  statusPending,
  busy,
  mode = "page",
  onClose,
  onPatch,
  onReveal,
  onControl,
  onSave,
}: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (mode !== "dialog") return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  const body = (
    <section className={`scoop-panel stack-service-editor${mode === "dialog" ? " is-dialog" : ""}`}>
      <div className="section-head">
        <h3>
          {svc.label}{" "}
          <span className={`stack-state is-${row?.state ?? "checking"}`}>
            {row?.state ?? "checking"}
          </span>
        </h3>
        <span className="stack-actions">
          {svc.control === "local" ? (
            <>
              <button type="button" className="scoop-btn" disabled={busy} onClick={() => onControl("start")}>
                Start
              </button>
              <button type="button" className="scoop-btn ghost" disabled={busy} onClick={() => onControl("stop")}>
                Stop
              </button>
            </>
          ) : (
            <span className="muted">Observed</span>
          )}
          {mode === "dialog" ? (
            <button type="button" className="scoop-btn ghost" ref={closeRef} onClick={onClose}>
              Close
            </button>
          ) : null}
        </span>
      </div>
      {row?.detail ? <p className="muted">{row.detail}</p> : statusPending ? <p className="muted">Checking…</p> : null}
      {STACK_FIELDS[svc.id].map((field) => {
        const value = String(svc[field.key] ?? "");
        return (
          <label key={field.key} className="field">
            <span>{field.label}</span>
            <span className="stack-field-row">
              <input
                value={value}
                spellCheck={false}
                type={field.secret ? "password" : "text"}
                autoComplete="off"
                onChange={(e) => onPatch(field.key, e.target.value)}
              />
              {field.reveal && value ? (
                <button type="button" className="scoop-btn ghost" onClick={() => onReveal(value)}>
                  Show in Explorer
                </button>
              ) : null}
            </span>
          </label>
        );
      })}
      {svc.files.map((file, index) => (
        <div key={`${file.path}-${index}`} className="stack-field-row">
          <span className="muted">{file.label}</span>
          <span className="muted">{file.path}</span>
          <button type="button" className="scoop-btn ghost" onClick={() => onReveal(file.path)}>
            Show in Explorer
          </button>
        </div>
      ))}
      <div className="stack-recover-actions">
        <button type="button" className="scoop-btn" disabled={busy} onClick={onSave}>
          Save paths
        </button>
      </div>
    </section>
  );

  if (mode !== "dialog") return body;

  return (
    <div className="stack-dialog-root" role="presentation" onClick={onClose}>
      <div
        className="stack-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${svc.label} details`}
        onClick={(event) => event.stopPropagation()}
      >
        {body}
      </div>
    </div>
  );
}
