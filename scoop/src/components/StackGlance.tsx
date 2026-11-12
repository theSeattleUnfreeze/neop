"use client";

import { SyncMeter } from "@/components/SyncMeter";
import { syncView } from "@/lib/stack/syncView";
import type { StackServiceId, StackStatusRow } from "@/lib/stack/types";

type Piece = {
  id: StackServiceId;
  role: "indexer" | "engine" | "tunnel";
  hint?: string;
};

const LANES: { tone: "core" | "knots"; title: string; pieces: Piece[] }[] = [
  {
    tone: "core",
    title: "Core",
    pieces: [
      { id: "core-fulcrum", role: "indexer" },
      { id: "core-node", role: "engine" },
    ],
  },
  {
    tone: "knots",
    title: "Knots",
    pieces: [
      { id: "knots-fulcrum", role: "indexer" },
      { id: "knots-node", role: "engine" },
      { id: "knots-link", role: "tunnel", hint: "optional" },
    ],
  },
];

type Props = {
  labels: Partial<Record<StackServiceId, string>>;
  endpoints: Partial<Record<StackServiceId, string>>;
  rows: StackStatusRow[];
  pending: boolean;
  busyIds?: Set<StackServiceId>;
  onSelect?: (id: StackServiceId) => void;
};

function tooltipText(label: string, state: string, detail: string, height: number | null, endpoint: string): string {
  const lines = [label, state];
  if (detail) lines.push(detail);
  if (height != null) lines.push(`height ${height.toLocaleString()}`);
  if (endpoint) lines.push(endpoint);
  lines.push("Click for details");
  return lines.join("\n");
}

export function StackGlance({ labels, endpoints, rows, pending, busyIds, onSelect }: Props) {
  return (
    <div className="stack-glance">
      <p className="muted stack-glance-note">
        Solid is up, striped is down, tinted outline is busy, dashed is still checking. A syncing
        node shows its block height. Fulcrum’s bar is its tip against that node’s blocks, once the
        node answers. Click a shape for its paths.
      </p>
      <div className="stack-lanes">
        {LANES.map((lane) => (
          <div key={lane.tone} className={`stack-lane tone-${lane.tone}`}>
            <h3>{lane.title}</h3>
            {lane.pieces.map((piece, index) => {
              const row = rows.find((item) => item.id === piece.id);
              const rawState = row?.state ?? (pending ? "checking" : "unset");
              const state = busyIds?.has(piece.id) && rawState === "down" ? "busy" : rawState;
              const label = labels[piece.id] ?? piece.id;
              const endpoint = row?.endpoint || endpoints[piece.id] || "";
              const detail = row?.detail ?? (pending ? "Checking…" : "");
              const tip = tooltipText(label, state, detail, row?.height ?? null, endpoint);
              return (
                <div key={piece.id} className="stack-piece">
                  {index > 0 ? <span className="stack-wire" aria-hidden="true" /> : null}
                  <button
                    type="button"
                    className={`stack-shape is-${piece.role} is-${state} tone-${lane.tone}`}
                    aria-label={tip}
                    onClick={() => onSelect?.(piece.id)}
                  >
                    <span>{label}</span>
                    {piece.hint ? <span className="stack-shape-hint">{piece.hint}</span> : null}
                  </button>
                  <span className="stack-tip" role="tooltip">
                    {tip}
                  </span>
                </div>
              );
            })}
            <ul className="stack-readout">
              {lane.pieces.map((piece) => {
                const row = rows.find((item) => item.id === piece.id);
                const nodeId = lane.tone === "core" ? "core-node" : "knots-node";
                const node = rows.find((item) => item.id === nodeId);
                const view = row ? syncView(row, node) : null;
                const label = labels[piece.id] ?? piece.id;
                const text = view?.label ?? row?.detail ?? (pending ? "Checking…" : "No status yet.");
                return (
                  <li key={piece.id}>
                    <span className="stack-readout-name">{label}</span>
                    {view ? (
                      <SyncMeter label={text} ratio={view.ratio} tone={lane.tone} />
                    ) : (
                      <p className="stack-sync-label">{text}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
