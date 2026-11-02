import type { StackStatusRow } from "@/lib/stack/types";

const TIP_SKEW_BLOCKS = 6;

export function summarizeStack(rows: StackStatusRow[]): { catalogReady: boolean; summary: string } {
  const core = rows.find((row) => row.id === "core-fulcrum");
  const knots = rows.find((row) => row.id === "knots-fulcrum");
  const coreNode = rows.find((row) => row.id === "core-node");

  if (!core || core.state !== "up" || !knots || knots.state !== "up") {
    const missing = [core, knots]
      .filter((row) => !row || row.state !== "up")
      .map((row) => row?.label ?? "indexer");
    return {
      catalogReady: false,
      summary: `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not answering. Coin labels need both indexers.`,
    };
  }

  if (core.height != null && knots.height != null) {
    const lag = Math.abs(core.height - knots.height);
    if (lag > TIP_SKEW_BLOCKS) {
      const nodeNote =
        coreNode?.state === "up" && coreNode.height != null && core.height < coreNode.height
          ? ` Core Fulcrum is ${coreNode.height - core.height} blocks behind its node.`
          : "";
      return {
        catalogReady: false,
        summary: `Both indexers are up, and their tips differ by ${lag.toLocaleString()} blocks. Wait until they meet before trusting Core / Knots / both.${nodeNote}`,
      };
    }
    return {
      catalogReady: true,
      summary: `Both indexers are caught up. Core ${core.height.toLocaleString()}, Knots ${knots.height.toLocaleString()}.`,
    };
  }

  return { catalogReady: true, summary: "Both indexers are answering." };
}
