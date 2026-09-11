"use client";

import type { annotate, CatalogFilter } from "@/lib/catalog/presence";
import { filterCatalogRows } from "@/lib/catalog/presence";

type Row = ReturnType<typeof annotate>;

function chipClass(presence: Row["presence"]): string {
  if (presence === "core_only") return "core";
  if (presence === "knots_only") return "knots";
  if (presence === "both") return "both";
  return "none";
}

function sats(tip: Row["core"]) {
  if (tip.status === "absent") return <span className="muted">—</span>;
  if (tip.status === "unspent") {
    return <span>{(tip.valueSats ?? 0).toLocaleString()} sats</span>;
  }
  return (
    <span>
      spent
      {tip.spendTxid ? ` · ${tip.spendTxid.slice(0, 8)}…` : ""}
    </span>
  );
}

export function CoinTable({
  rows,
  filter = "all",
}: {
  rows: Row[];
  filter?: CatalogFilter;
}) {
  const shown = filterCatalogRows(rows, filter);
  if (!rows.length) {
    return <p className="muted">No addresses in this wallet yet.</p>;
  }
  if (!shown.length) {
    return <p className="muted">No addresses match this filter.</p>;
  }
  return (
    <div className="coin-table-wrap">
      <table className="coin-table">
        <thead>
          <tr>
            <th>Address</th>
            <th>Core</th>
            <th>Knots</th>
            <th>Presence</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={`${r.scriptId}-${r.address ?? "row"}-${i}`}>
              <td className="mono">{r.address ?? `#${r.scriptId}`}</td>
              <td>{sats(r.core)}</td>
              <td>{sats(r.knots)}</td>
              <td>
                <span className={`presence-chip ${chipClass(r.presence)}`}>
                  {r.presence === "none" ? "empty" : r.presence.replace("_", " ")}
                </span>
              </td>
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
