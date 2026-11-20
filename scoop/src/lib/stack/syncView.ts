import type { StackStatusRow } from "@/lib/stack/types";

const CAUGHT_UP_BLOCKS = 6;

export type SyncView = {
  label: string;
  /** 0–1. Empty when there is nothing left to draw. */
  ratio: number | null;
};

function isNode(id: StackStatusRow["id"]): boolean {
  return id === "core-node" || id === "knots-node";
}

function isIndexer(id: StackStatusRow["id"]): boolean {
  return id === "core-fulcrum" || id === "knots-fulcrum";
}

/** What the Stack page draws under a lane. Fulcrum’s bar uses the paired node’s block count. */
export function syncView(row: StackStatusRow, node?: StackStatusRow): SyncView | null {
  if (isNode(row.id)) {
    if (row.state !== "up" || row.height == null) return null;
    const headersAhead = row.headers != null && row.headers > row.height;
    const fraction = row.progress != null && row.progress < 0.999 ? row.progress : null;
    const ratio = fraction != null ? fraction : headersAhead && row.headers ? row.height / row.headers : null;
    const headerNote = headersAhead ? ` · headers ${row.headers!.toLocaleString()}` : "";
    const pct = ratio != null ? ` · ${(ratio * 100).toFixed(1)}%` : "";
    return {
      label: `height ${row.height.toLocaleString()}${headerNote}${pct}`,
      ratio,
    };
  }
  if (isIndexer(row.id)) {
    if (row.state !== "up" || row.height == null) return null;
    const target = node?.state === "up" ? node.height : null;
    if (target == null || target <= 0) {
      return { label: `tip ${row.height.toLocaleString()}`, ratio: null };
    }
    const lag = target - row.height;
    if (Math.abs(lag) <= CAUGHT_UP_BLOCKS) {
      return { label: `tip ${row.height.toLocaleString()}, caught up to the node`, ratio: null };
    }
    if (lag < 0) {
      return {
        label: `tip ${row.height.toLocaleString()}, ${(-lag).toLocaleString()} blocks ahead of the node`,
        ratio: null,
      };
    }
    return {
      label: `${row.height.toLocaleString()} of ${target.toLocaleString()} blocks`,
      ratio: Math.min(1, row.height / target),
    };
  }
  return null;
}
