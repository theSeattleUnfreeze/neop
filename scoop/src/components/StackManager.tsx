"use client";

import { useCallback, useEffect, useState } from "react";
import type { StackConfig, StackService, StackServiceId, StackStatusRow } from "@/lib/stack/types";

const LOCAL = { "content-type": "application/json", "x-scoop-local": "1" };

const FIELDS: Record<StackServiceId, { key: keyof StackService; label: string; reveal?: boolean }[]> = {
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
    { key: "publish", label: "Published port" },
  ],
  "knots-node": [{ key: "endpoint", label: "RPC URL (tunnel)" }],
  "knots-fulcrum": [{ key: "endpoint", label: "Electrum URL" }],
  "knots-link": [
    { key: "endpoint", label: "Local RPC URL" },
    { key: "startosHost", label: "StartOS host" },
    { key: "script", label: "Tunnel script", reveal: true },
    { key: "identityFile", label: "SSH identity", reveal: true },
    { key: "logFile", label: "Log", reveal: true },
  ],
};

export function StackManager() {
  const [config, setConfig] = useState<StackConfig | null>(null);
  const [rows, setRows] = useState<StackStatusRow[]>([]);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [cfgRes, statusRes] = await Promise.all([
      fetch("/api/stack/config", { cache: "no-store" }),
      fetch("/api/stack/status", { cache: "no-store" }),
    ]);
    const cfgJson = await cfgRes.json();
    const statusJson = await statusRes.json();
    if (!cfgRes.ok) throw new Error(cfgJson.error ?? "could not load stack config");
    setConfig(cfgJson.config);
    if (statusRes.ok) {
      setRows(statusJson.rows ?? []);
      setSummary(statusJson.summary ?? "");
    }
  }, []);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);

  const patch = (id: StackServiceId, key: keyof StackService, value: string) => {
    setConfig((current) => {
      if (!current) return current;
      return {
        services: current.services.map((svc) => (svc.id === id ? { ...svc, [key]: value } : svc)),
      };
    });
  };

  const save = async () => {
    if (!config) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stack/config", {
        method: "PUT",
        headers: LOCAL,
        body: JSON.stringify(config),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "save failed");
      setConfig(json.config);
      setNotice("Saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const reveal = async (filePath: string) => {
    setError(null);
    const res = await fetch("/api/stack/reveal", {
      method: "POST",
      headers: LOCAL,
      body: JSON.stringify({ path: filePath }),
    });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "could not open Explorer");
  };

  const control = async (id: StackServiceId, action: "start" | "stop") => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (config) {
        const saved = await fetch("/api/stack/config", {
          method: "PUT",
          headers: LOCAL,
          body: JSON.stringify(config),
        });
        if (!saved.ok) {
          const json = await saved.json();
          throw new Error(json.error ?? "save failed");
        }
      }
      const res = await fetch("/api/stack/service", {
        method: "POST",
        headers: LOCAL,
        body: JSON.stringify({ id, action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "action failed");
      setNotice(json.message ?? "Done.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!config) return <p className="muted">Loading stack…</p>;

  return (
    <div className="scoop-stack">
      <section className="scoop-panel">
        <div className="section-head">
          <h2>Stack</h2>
          <button type="button" className="scoop-btn" onClick={() => void save()} disabled={busy}>
            Save paths
          </button>
        </div>
        <p className="muted">
          Locations for the node, the indexers, and the files you edit by hand. Start and stop
          apply to this computer. Knots on StartOS stays a status row.
        </p>
        {summary ? <p className="banner warn">{summary}</p> : null}
        {notice ? <p className="banner ok">{notice}</p> : null}
        {error ? <p className="banner bad">{error}</p> : null}
      </section>
      {config.services.map((svc) => {
        const row = rows.find((item) => item.id === svc.id);
        return (
          <section key={svc.id} className="scoop-panel">
            <div className="section-head">
              <h3>
                {svc.label}{" "}
                <span className={`stack-state is-${row?.state ?? "unset"}`}>{row?.state ?? "…"}</span>
              </h3>
              {svc.control === "local" ? (
                <span className="stack-actions">
                  <button type="button" className="scoop-btn" disabled={busy} onClick={() => void control(svc.id, "start")}>
                    Start
                  </button>
                  <button type="button" className="scoop-btn ghost" disabled={busy} onClick={() => void control(svc.id, "stop")}>
                    Stop
                  </button>
                </span>
              ) : (
                <span className="muted">Observed</span>
              )}
            </div>
            {row?.detail ? <p className="muted">{row.detail}</p> : null}
            {FIELDS[svc.id].map((field) => {
              const value = String(svc[field.key] ?? "");
              return (
                <label key={field.key} className="field">
                  <span>{field.label}</span>
                  <span className="stack-field-row">
                    <input
                      value={value}
                      spellCheck={false}
                      onChange={(e) => patch(svc.id, field.key, e.target.value)}
                    />
                    {field.reveal && value ? (
                      <button type="button" className="scoop-btn ghost" onClick={() => void reveal(value)}>
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
                <button type="button" className="scoop-btn ghost" onClick={() => void reveal(file.path)}>
                  Show in Explorer
                </button>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
