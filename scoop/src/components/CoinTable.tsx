"use client";

import type { CatalogFilter } from "@/lib/catalog/presence";
import { filterCatalogRows } from "@/lib/catalog/presence";
import {
  groupOutpointRows,
  type OutpointRow,
  type WitnessState,
} from "@/lib/catalog/outpoints";

type Row = OutpointRow;

function chipClass(row: Row): string {
  if (row.classified === false) return "none";
  if (row.coreBoundOk) return "bound";
  if (row.presence === "core_only") return "core";
  if (row.presence === "knots_only") return "knots";
  if (row.presence === "both") return "both";
  return "none";
}

function presenceLabel(row: Row): string {
  if (row.classified === false) return "unconfirmed";
  if (row.coreBoundOk) return "core-bound";
  if (row.presence === "none") return "empty";
  return row.presence.replaceAll("_", " ");
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

function witnessLabel(state: WitnessState | undefined): string {
  if (state === "published") return "Witness published";
  if (state === "hashed") return "Witness still hashed";
  return "Witness unknown";
}

export function CoinTable({
  rows,
  filter = "all",
}: {
  rows: Row[];
  filter?: CatalogFilter;
}) {
  const shown = groupOutpointRows(rows)
    .map((group) => ({
      ...group,
      outpoints: filterCatalogRows(group.outpoints, filter),
    }))
    .filter((group) => group.outpoints.length > 0);

  if (!rows.length) {
    return <p className="muted">No outpoints in this wallet yet.</p>;
  }
  if (!shown.length) {
    return <p className="muted">No outpoints match this filter.</p>;
  }
  return (
    <div className="coin-table-wrap">
      <table className="coin-table">
        <thead>
          <tr>
            <th>Outpoint</th>
            <th>Core</th>
            <th>Knots</th>
            <th>Presence</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((group) => (
            <GroupRows key={group.key} group={group} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({
  group,
}: {
  group: {
    scriptId: number;
    address?: string | null;
    mixed: boolean;
    witness: WitnessState;
    outpoints: Row[];
  };
}) {
  return (
    <>
      <tr className="coin-group">
        <td colSpan={5}>
          <span className="mono">{group.address ?? `script ${group.scriptId}`}</span>
          {group.mixed ? <span className="presence-chip mixed">Mixed</span> : null}
          <span className={`flag witness ${group.witness}`}>{witnessLabel(group.witness)}</span>
          {group.mixed ? (
            <span className="muted group-note">
              Different outpoints, different chains. Not replay risk.
            </span>
          ) : null}
        </td>
      </tr>
      {group.outpoints.map((r) => (
        <tr key={`${r.scriptId}:${r.txid}:${r.vout}`}>
          <td className="mono">
            {r.txid.slice(0, 8)}…:{r.vout}
          </td>
          <td>{sats(r.core)}</td>
          <td>{sats(r.knots)}</td>
          <td>
            <span className={`presence-chip ${chipClass(r)}`}>
              {presenceLabel(r)}
            </span>
          </td>
          <td className="flags">
            {r.replayRisk ? <span className="flag spill">replay</span> : null}
            {r.coreBoundOk ? <span className="flag ok">core-bound ok</span> : null}
            {r.spill ? <span className="flag spill">spill</span> : null}
          </td>
        </tr>
      ))}
    </>
  );
}
