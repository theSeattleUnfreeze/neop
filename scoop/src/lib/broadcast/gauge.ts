/** How full the six-confirmation ring is. No chain data. */

import type { RowStatus } from "@/lib/broadcast/watch";

export type Gauge = {
  filled: number;
  alert: boolean;
  text: string;
};

export function confirmationGauge(status: RowStatus, confirmations: number): Gauge {
  if (status === "reorged") return { filled: 0, alert: true, text: "A block was replaced." };
  if (status === "conflict") return { filled: 0, alert: true, text: "Another spend is in the way." };
  if (status === "missing") return { filled: 0, alert: false, text: "Not seen yet." };
  if (status === "mempool") return { filled: 0, alert: false, text: "In the mempool." };
  const count = Number.isFinite(confirmations) ? Math.max(0, Math.floor(confirmations)) : 0;
  const filled = Math.min(6, count);
  return {
    filled,
    alert: false,
    text: count >= 6 ? "6 confirmations." : `${count} of 6 confirmations.`,
  };
}
