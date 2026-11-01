import type { AnnotatedRow } from "@/lib/catalog/balances";

export type SuggestedTask = {
  dedupeKey: string;
  kind: "auto_both" | "auto_spill" | "auto_core_bound" | "auto_replay_receive";
  title: string;
  body: string;
  scriptId: number;
  metadata?: Record<string, string>;
};

/**
 * Build auto task suggestions from annotated sync rows.
 * Replay-receive tasks are usually created by applyReplayReceiveSync;
 * this still emits auto_both for dual presence without requiring outpoint match.
 */
export function suggestTasksFromRows(
  rows: AnnotatedRow[],
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
    if (r.presence === "both" && !r.spill) {
      const coreUnspent = r.core.status === "unspent";
      const knotsUnspent = r.knots.status === "unspent";
      if (coreUnspent && knotsUnspent) {
        const sameOutpoint =
          r.core.txid &&
          r.knots.txid &&
          r.core.txid.toLowerCase() === r.knots.txid.toLowerCase() &&
          r.core.vout === r.knots.vout;
        if (sameOutpoint) {
          out.push({
            dedupeKey: `auto_replay_receive:script:${r.scriptId}:${r.core.txid}:${r.core.vout}`,
            kind: "auto_replay_receive",
            title: `${prefix}Replay received — split before spending (${label})`,
            body: "Same outpoint unspent on Core and Knots. Split before spending on either tip.",
            scriptId: r.scriptId,
            metadata: {
              txid: r.core.txid!,
              vout: String(r.core.vout ?? 0),
            },
          });
        } else {
          out.push({
            dedupeKey: `auto_both:script:${r.scriptId}`,
            kind: "auto_both",
            title: `${prefix}Plan split ceremony for ${label}`,
            body: "Present on both tips. Plan a replay-safe split before ordinary spends.",
            scriptId: r.scriptId,
          });
        }
      } else if (r.presence === "both") {
        out.push({
          dedupeKey: `auto_both:script:${r.scriptId}`,
          kind: "auto_both",
          title: `${prefix}Plan split ceremony for ${label}`,
          body: "Present on both tips. Plan a replay-safe split before ordinary spends.",
          scriptId: r.scriptId,
        });
      }
    }
  }

  return out;
}
