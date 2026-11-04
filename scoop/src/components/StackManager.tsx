"use client";

import { useCallback, useEffect, useState } from "react";
import { StackGlance } from "@/components/StackGlance";
import { StackRecover, type StackDiagnosisView } from "@/components/StackRecover";
import { StackServiceEditor } from "@/components/StackServiceEditor";
import type { StackConfig, StackService, StackServiceId, StackStatusRow } from "@/lib/stack/types";

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

  const loadStatus = useCallback(async () => {
    setStatusPending(true);
    try {
      const statusRes = await fetch("/api/stack/status", { cache: "no-store", headers: LOCAL });
      const statusJson = await statusRes.json();
      if (!statusRes.ok) throw new Error(statusJson.error ?? "stack status failed");
      setRows(statusJson.rows ?? []);
      setSummary(statusJson.summary ?? "");
      void loadDiagnose().catch(() => undefined);
    } finally {
      setStatusPending(false);
    }
  }, [loadDiagnose]);

  useEffect(() => {
    void loadConfig().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    void loadStatus().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [loadConfig, loadStatus]);

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
          svc={focused}
          row={rows.find((item) => item.id === focused.id)}
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
