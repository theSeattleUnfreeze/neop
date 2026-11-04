import type { AnnotatedRow } from "@/lib/catalog/balances";
import { sameUnspentOutpoint } from "@/lib/catalog/presence";

export type SuggestedTask = {
  dedupeKey: string;
  kind: "auto_both" | "auto_spill" | "auto_core_bound" | "auto_replay_receive";
  title: string;
  body: string;
  scriptId: number;
  metadata?: Record<string, string>;
};

/**
 * Build auto task suggestions from per-outpoint sync rows.
 * Replay risk is the same outpoint unspent on both tips.
 * Different outpoints on one address do not get a split task.
 */
export function suggestTasksFromRows(
  rows: (AnnotatedRow & { replayRisk?: boolean })[],
  opts: { accountId?: number; labelPrefix?: string } = {}
): SuggestedTask[] {
  const prefix = opts.labelPrefix ? `${opts.labelPrefix}: ` : "";
  const out: SuggestedTask[] = [];

  for (const r of rows) {
    const label = r.address?.trim() || `#${r.scriptId}`;
    if (r.spill) {
      out.push({
        dedupeKey: `auto_spill:script:${r.scriptId}`,
        kind: "auto_spill",
        title: `${prefix}Review likely dual-tip spend — ${label}`,
        body: "Spent on both Core and Knots. Confirm whether this was intentional dual-effect.",
        scriptId: r.scriptId,
      });
    }
    if (r.coreBoundOk) {
      out.push({
        dedupeKey: `auto_core_bound:script:${r.scriptId}`,
        kind: "auto_core_bound",
        title: `${prefix}Verify Knots mirror still unspent — ${label}`,
        body: "Core spent while Knots remains unspent — expected after a Core-bound ceremony.",
        scriptId: r.scriptId,
      });
    }
    const replay = r.replayRisk === true || sameUnspentOutpoint(r.core, r.knots);
    if (replay && r.core.txid) {
      out.push({
        dedupeKey: `auto_replay_receive:script:${r.scriptId}:${r.core.txid}:${r.core.vout ?? 0}`,
        kind: "auto_replay_receive",
        title: `${prefix}Replay received — split before spending (${label})`,
        body: "This outpoint is unspent on Core and Knots. A spend made only of such outpoints can confirm on both chains. Include a Knots-only input, or sweep the whole Knots side in one signed wave, before broadcasting.",
        scriptId: r.scriptId,
        metadata: {
          txid: r.core.txid,
          vout: String(r.core.vout ?? 0),
        },
      });
    }
  }

  return out;
}
