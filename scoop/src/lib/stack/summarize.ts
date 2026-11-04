import type { StackStatusRow } from "@/lib/stack/types";

const TIP_SKEW_BLOCKS = 6;

function lagNote(
  chain: string,
  node: StackStatusRow | undefined,
  indexer: StackStatusRow | undefined
): { ok: boolean; note: string } {
  if (!indexer || indexer.state !== "up" || indexer.height == null) {
    return { ok: false, note: `${chain} Fulcrum is not answering with a tip.` };
  }
  if (!node || node.state !== "up") {
    return {
      ok: true,
      note: `${chain} Fulcrum tip ${indexer.height.toLocaleString()} (node tip unknown).`,
    };
  }
  if (node.height == null) {
    return {
      ok: true,
      note: `${chain} Fulcrum tip ${indexer.height.toLocaleString()} (node height unknown).`,
    };
  }
  const lag = node.height - indexer.height;
  if (Math.abs(lag) > TIP_SKEW_BLOCKS) {
    const behind = lag > 0 ? `${lag.toLocaleString()} blocks behind its node` : `${(-lag).toLocaleString()} blocks ahead of its node`;
    return {
      ok: false,
      note: `${chain} Fulcrum tip ${indexer.height.toLocaleString()} is ${behind} (node ${node.height.toLocaleString()}).`,
    };
  }
  return {
    ok: true,
    note: `${chain} Fulcrum tip ${indexer.height.toLocaleString()} matches its node.`,
  };
}

/**
 * Catalog readiness is per chain: each Fulcrum must be near its own node.
 * Core tip vs Knots tip is not compared — the hard fork makes that gap expected.
 */
export function summarizeStack(rows: StackStatusRow[]): { catalogReady: boolean; summary: string } {
  const core = rows.find((row) => row.id === "core-fulcrum");
  const knots = rows.find((row) => row.id === "knots-fulcrum");
  const coreNode = rows.find((row) => row.id === "core-node");
  const knotsNode = rows.find((row) => row.id === "knots-node");

  if (!core || core.state !== "up" || !knots || knots.state !== "up") {
    const missing = [core, knots]
      .filter((row) => !row || row.state !== "up")
      .map((row) => row?.label ?? "indexer");
    return {
      catalogReady: false,
      summary: `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not answering. Coin labels need both indexers.`,
    };
  }

  const coreLag = lagNote("Core", coreNode, core);
  const knotsLag = lagNote("Knots", knotsNode, knots);
  const catalogReady = coreLag.ok && knotsLag.ok;
  return {
    catalogReady,
    summary: catalogReady
      ? `Both indexers are caught up on their own chains. ${coreLag.note} ${knotsLag.note}`
      : `${[coreLag, knotsLag]
          .filter((item) => !item.ok)
          .map((item) => item.note)
          .join(" ")} Wait until each Fulcrum meets its node before trusting Core / Knots / both.`,
  };
}
