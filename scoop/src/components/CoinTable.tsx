"use client";

import { formatActivityStamp } from "@/lib/catalog/activity";
import type { CatalogFilter } from "@/lib/catalog/presence";
import { filterCatalogRows } from "@/lib/catalog/presence";
import {
  groupOutpointRows,
  type OutpointRow,
  type WitnessState,
} from "@/lib/catalog/outpoints";
import {
  WitnessExposureBadge,
  type WitnessExposureInfo,
} from "@/components/WitnessExposure";
import type { ExplorerBases } from "@/lib/explorer/urls";
import {
  DEFAULT_EXPLORER_CORE,
  DEFAULT_EXPLORER_KNOTS,
} from "@/lib/explorer/urls";
import { outpointDomId } from "@/lib/organizer/walletLinks";

type Row = OutpointRow;

export type ScriptWitness = {
  id: number;
  witnessState?: string | null;
  witnessExposedTxid?: string | null;
  witnessExposedTip?: string | null;
  witnessExposedHeight?: number | null;
  witnessExposedAt?: string | null;
};

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
  if (state === "published") return "Pubkey exposed on-chain";
  if (state === "hashed") return "Pubkey never exposed";
  return "Pubkey status unknown";
}

function exposureFromScript(script: ScriptWitness | undefined): WitnessExposureInfo | null {
  if (!script?.witnessExposedTxid) return null;
  const tip = script.witnessExposedTip === "knots" ? "knots" : "core";
  return {
    tip,
    txid: script.witnessExposedTxid,
    height: script.witnessExposedHeight ?? null,
    at: script.witnessExposedAt ?? null,
  };
}

export function CoinTable({
  rows,
  filter = "all",
  emptyHint,
  scripts = [],
  explorers = { core: DEFAULT_EXPLORER_CORE, knots: DEFAULT_EXPLORER_KNOTS },
  onExplorersChange,
  highlightOutpoint = null,
}: {
  rows: Row[];
  filter?: CatalogFilter;
  emptyHint?: string;
  scripts?: ScriptWitness[];
  explorers?: ExplorerBases;
  onExplorersChange?: (next: ExplorerBases) => void;
  highlightOutpoint?: { txid: string; vout: number } | null;
}) {
  const byScript = new Map(scripts.map((s) => [s.id, s]));
  const shown = groupOutpointRows(rows)
    .map((group) => ({
      ...group,
      outpoints: filterCatalogRows(group.outpoints, filter),
      exposure: exposureFromScript(byScript.get(group.scriptId)),
    }))
    .filter((group) => group.outpoints.length > 0);

  if (!rows.length) {
    return <p className="muted">{emptyHint ?? "No outpoints in this wallet yet."}</p>;
  }
  if (!shown.length) {
    return <p className="muted">{emptyHint ?? "No outpoints match this filter."}</p>;
  }
  return (
    <div className="coin-table-wrap">
      <table className="coin-table">
        <thead>
          <tr>
            <th>Outpoint</th>
            <th>Received</th>
            <th>Core</th>
            <th>Knots</th>
            <th>Presence</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((group) => (
            <GroupRows
              key={group.key}
              group={group}
              explorers={explorers}
              onExplorersChange={onExplorersChange}
              highlightOutpoint={highlightOutpoint}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({
  group,
  explorers,
  onExplorersChange,
  highlightOutpoint,
}: {
  group: {
    scriptId: number;
    address?: string | null;
    mixed: boolean;
    witness: WitnessState;
    outpoints: Row[];
    exposure: WitnessExposureInfo | null;
  };
  explorers: ExplorerBases;
  onExplorersChange?: (next: ExplorerBases) => void;
  highlightOutpoint?: { txid: string; vout: number } | null;
}) {
  return (
    <>
      <tr className="coin-group">
        <td colSpan={6}>
          <span className="mono">{group.address ?? `script ${group.scriptId}`}</span>
          {group.mixed ? <span className="presence-chip mixed">Mixed</span> : null}
          {group.witness === "published" ? (
            <WitnessExposureBadge
              exposure={group.exposure}
              explorers={explorers}
              onExplorersChange={onExplorersChange}
            />
          ) : (
            <span className={`flag witness ${group.witness}`}>{witnessLabel(group.witness)}</span>
          )}
          {group.mixed ? (
            <span className="muted group-note">
              Different outpoints, different chains. Not replay risk.
            </span>
          ) : null}
        </td>
      </tr>
      {group.outpoints.map((r) => {
        const highlighted =
          highlightOutpoint != null &&
          r.txid.toLowerCase() === highlightOutpoint.txid &&
          r.vout === highlightOutpoint.vout;
        return (
        <tr
          key={`${r.scriptId}:${r.txid}:${r.vout}`}
          id={outpointDomId(r.txid, r.vout)}
          className={highlighted ? "outpoint-highlight" : undefined}
        >
          <td className="mono">
            {r.txid.slice(0, 8)}…:{r.vout}
          </td>
          <td className="muted">
            {formatActivityStamp({ height: r.receivedHeight, at: r.receivedAt })}
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
        );
      })}
    </>
  );
}
