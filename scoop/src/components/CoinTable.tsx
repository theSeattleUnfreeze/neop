"use client";

import type { annotate } from "@/lib/catalog/presence";

type Row = ReturnType<typeof annotate>;

function chipClass(presence: Row["presence"]): string {
  if (presence === "core_only") return "core";
  if (presence === "knots_only") return "knots";
  if (presence === "both") return "both";
  return "both";
}

function statusCell(tip: Row["core"]) {
  if (tip.status === "absent") return <span className="muted">—</span>;
  if (tip.status === "unspent") {
    return (
      <span>
        unspent
        {tip.valueSats !== undefined ? ` (${tip.valueSats.toString()} sats)` : ""}
      </span>
    );
  }
  return (
    <span>
      spent
      {tip.spendTxid ? ` · ${tip.spendTxid.slice(0, 8)}…` : ""}
    </span>
  );
}

export function CoinTable({ rows }: { rows: Row[] }) {
  if (!rows.length) {
    return <p className="muted">No coins to show. Run sync with watched scripthashes.</p>;
  }
  return (
    <div className="coin-table-wrap">
      <table className="coin-table">
        <thead>
          <tr>
            <th>Presence</th>
            <th>Address</th>
            <th>Core</th>
            <th>Knots</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.scriptId}-${r.address ?? "row"}-${i}`}>
              <td>
                <span className={`presence-chip ${chipClass(r.presence)}`}>{r.presence}</span>
              </td>
              <td className="mono">{r.address ?? `#${r.scriptId}`}</td>
              <td>{statusCell(r.core)}</td>
              <td>{statusCell(r.knots)}</td>
              <td className="flags">
                {r.coreBoundOk ? <span className="flag ok">core-bound ok</span> : null}
                {r.spill ? <span className="flag spill">spill</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
