"use client";

import { useCallback, useEffect, useState } from "react";
import { StackGlance } from "@/components/StackGlance";
import { StackRecover, type StackDiagnosisView } from "@/components/StackRecover";
import { StackServiceEditor } from "@/components/StackServiceEditor";
import { STACK_SERVICE_IDS, type StackConfig, type StackService, type StackServiceId, type StackStatusRow } from "@/lib/stack/types";

const LOCAL = { "content-type": "application/json", "x-scoop-local": "1" };

export function StackManager() {
  const [config, setConfig] = useState<StackConfig | null>(null);
  const [rows, setRows] = useState<StackStatusRow[]>([]);
  const [statusPending, setStatusPending] = useState(true);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [diagnoses, setDiagnoses] = useState<StackDiagnosisView[]>([]);
  const [focusId, setFocusId] = useState<StackServiceId | null>(null);

  const loadConfig = useCallback(async () => {
    const cfgRes = await fetch("/api/stack/config", { cache: "no-store", headers: LOCAL });
    const cfgJson = await cfgRes.json();
    if (!cfgRes.ok) throw new Error(cfgJson.error ?? "could not load stack config");
    setConfig(cfgJson.config);
  }, []);

  const loadDiagnose = useCallback(async () => {
    const res = await fetch("/api/stack/diagnose", { cache: "no-store", headers: LOCAL });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "diagnose failed");
    setDiagnoses(json.diagnoses ?? []);
  }, []);

  const loadStatus = useCallback(async (quiet = false) => {
    if (!quiet) setStatusPending(true);
    try {
      const statusRes = await fetch("/api/stack/status", { cache: "no-store", headers: LOCAL });
      const statusJson = await statusRes.json();
      if (!statusRes.ok) throw new Error(statusJson.error ?? "stack status failed");
      setRows(statusJson.rows ?? []);
      setSummary(statusJson.summary ?? "");
      void loadDiagnose().catch(() => undefined);
    } finally {
      if (!quiet) setStatusPending(false);
    }
  }, [loadDiagnose]);

  useEffect(() => {
    void loadConfig().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    void loadStatus().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    const timer = setInterval(() => {
      void loadStatus(true).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }, 15_000);
    return () => clearInterval(timer);
  }, [loadConfig, loadStatus]);

  useEffect(() => {
    const service = new URLSearchParams(window.location.search).get("service");
    if (service && (STACK_SERVICE_IDS as readonly string[]).includes(service)) {
      setFocusId(service as StackServiceId);
    }
  }, []);

  const patch = (id: StackServiceId, key: keyof StackService, value: string) => {
    setConfig((current) => {
      if (!current) return current;
      return {
        ...current,
        services: current.services.map((svc) => (svc.id === id ? { ...svc, [key]: value } : svc)),
      };
    });
  };

  const patchExplorer = (tip: "core" | "knots", value: string) => {
    setConfig((current) => {
      if (!current) return current;
      return {
        ...current,
        explorers: { ...current.explorers, [tip]: value },
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
      void loadStatus().catch(() => undefined);
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
      void loadStatus().catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!config) return <p className="muted">Loading stack…</p>;

  const focused = focusId ? config.services.find((svc) => svc.id === focusId) : null;
  const busyIds = new Set(
    diagnoses.filter((item) => item.severity === "busy").map((item) => item.id)
  );

  return (
    <div className="scoop-stack">
      <section className="scoop-panel">
        <div className="section-head">
          <h2>Stack</h2>
        </div>
        <p className="muted">
          Start on this page asks the Scoop process on this PC to launch Core, Core Fulcrum, or the
          local tunnel. The browser does not run those programs, and this page does not open SSH.
          A remote start command is saved here and run by <span className="mono">scoop.cmd</span>.
        </p>
        {summary ? <p className="banner warn">{summary}</p> : statusPending ? <p className="muted">Checking services…</p> : null}
        {notice ? <p className="banner ok">{notice}</p> : null}
        {error ? <p className="banner bad">{error}</p> : null}
        <StackGlance
          labels={Object.fromEntries(config.services.map((svc) => [svc.id, svc.label]))}
          endpoints={Object.fromEntries(config.services.map((svc) => [svc.id, svc.endpoint]))}
          rows={rows}
          pending={statusPending}
          busyIds={busyIds}
          onSelect={(id) => setFocusId(id)}
        />
        <div className="stack-explorers">
          <h3>Block explorers</h3>
          <p className="muted">
            Used for pubkey-exposure and transaction links. Core defaults to mempool.space; Knots
            defaults to mempool.guide. Env <span className="mono">SCOOP_EXPLORER_CORE</span> /{" "}
            <span className="mono">SCOOP_EXPLORER_KNOTS</span> override these when set.
          </p>
          <label className="field">
            <span>Core explorer base</span>
            <input
              value={config.explorers?.core ?? ""}
              placeholder="https://mempool.space"
              onChange={(e) => patchExplorer("core", e.target.value)}
            />
          </label>
          <label className="field">
            <span>Knots explorer base</span>
            <input
              value={config.explorers?.knots ?? ""}
              placeholder="https://mempool.guide"
              onChange={(e) => patchExplorer("knots", e.target.value)}
            />
          </label>
          <button type="button" className="scoop-btn" onClick={() => void save()} disabled={busy}>
            Save explorers
          </button>
        </div>
      </section>
      {!statusPending ? (
        <StackRecover
          diagnoses={diagnoses}
          busy={busy}
          onStart={(id) => void control(id, "start")}
          onReveal={(filePath) => void reveal(filePath)}
          onApply={(id, key, value) => {
            patch(id, key, value);
            setFocusId(id);
            setNotice(`Filled ${String(key)}. Save in the panel, then Start if needed.`);
          }}
          onOpenDetails={(id) => setFocusId(id)}
        />
      ) : null}
      <details className="stack-details">
        <summary>All service paths</summary>
        <div className="section-head stack-details-bar">
          <p className="muted">
            Locations for every service. Prefer Open Details on a recovery card or a shape above;
            that opens one service in front of you.
          </p>
          <button type="button" className="scoop-btn" onClick={() => void save()} disabled={busy}>
            Save paths
          </button>
        </div>
        {config.services.map((svc) => (
          <StackServiceEditor
            key={svc.id}
            svc={svc}
            row={rows.find((item) => item.id === svc.id)}
            nodeRow={rows.find((item) => item.id === (svc.id.startsWith("knots") ? "knots-node" : "core-node"))}
            statusPending={statusPending}
            busy={busy}
            onPatch={(key, value) => patch(svc.id, key, value)}
            onReveal={(filePath) => void reveal(filePath)}
            onControl={(action) => void control(svc.id, action)}
            onSave={() => void save()}
          />
        ))}
      </details>
      {focused ? (
        <StackServiceEditor
          key={focused.id}
          svc={focused}
          row={rows.find((item) => item.id === focused.id)}
          nodeRow={rows.find((item) => item.id === (focused.id.startsWith("knots") ? "knots-node" : "core-node"))}
          statusPending={statusPending}
          busy={busy}
          mode="dialog"
          onClose={() => setFocusId(null)}
          onPatch={(key, value) => patch(focused.id, key, value)}
          onReveal={(filePath) => void reveal(filePath)}
          onControl={(action) => void control(focused.id, action)}
          onSave={() => void save()}
        />
      ) : null}
    </div>
  );
}
