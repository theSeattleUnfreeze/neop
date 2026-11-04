"use client";

import type { StackService, StackServiceId } from "@/lib/stack/types";

export type StackDiagnosisView = {
  id: StackServiceId;
  label: string;
  platform: string;
  severity: "ok" | "busy" | "action" | "remote";
  headline: string;
  processRunning: boolean;
  portOpen: boolean | null;
  canStart: boolean;
  steps: {
    title: string;
    body: string;
    revealPath?: string;
    suggest?: { key: keyof StackService; value: string };
  }[];
};

type Props = {
  diagnoses: StackDiagnosisView[];
  busy: boolean;
  onStart: (id: StackServiceId) => void;
  onReveal: (path: string) => void;
  onApply: (id: StackServiceId, key: keyof StackService, value: string) => void;
  onOpenDetails: (id: StackServiceId) => void;
};

export function StackRecover({ diagnoses, busy, onStart, onReveal, onApply, onOpenDetails }: Props) {
  const interesting = diagnoses.filter((item) => item.severity !== "ok");
  if (!interesting.length) return null;

  return (
    <section className="scoop-panel stack-recover">
      <h3>Get it running</h3>
      <p className="muted">
        Scoop looked on this {interesting[0]?.platform ?? "host"} for binaries, Docker, and open
        ports. Start only applies to services that live on this computer.
      </p>
      <div className="stack-recover-list">
        {interesting.map((item) => (
          <article key={item.id} className={`stack-recover-card is-${item.severity}`}>
            <div className="section-head">
              <h4>{item.label}</h4>
              <span className="muted">{item.severity}</span>
            </div>
            <p>{item.headline}</p>
            <ul>
              {item.steps.map((step) => (
                <li key={step.title}>
                  <strong>{step.title}</strong>
                  <span className="muted"> {step.body}</span>
                  <span className="stack-recover-actions">
                    {step.suggest ? (
                      <button
                        type="button"
                        className="scoop-btn ghost"
                        disabled={busy}
                        onClick={() => onApply(item.id, step.suggest!.key, step.suggest!.value)}
                      >
                        Use this path
                      </button>
                    ) : null}
                    {step.revealPath ? (
                      <button
                        type="button"
                        className="scoop-btn ghost"
                        disabled={busy}
                        onClick={() => void onReveal(step.revealPath!)}
                      >
                        Show in Explorer
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            <div className="stack-recover-actions">
              {item.canStart ? (
                <button
                  type="button"
                  className="scoop-btn"
                  disabled={busy}
                  onClick={() => void onStart(item.id)}
                >
                  Start {item.label}
                </button>
              ) : null}
              <button type="button" className="scoop-btn ghost" onClick={() => onOpenDetails(item.id)}>
                Open Details
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
