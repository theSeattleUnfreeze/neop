import { confirmationGauge } from "@/lib/broadcast/gauge";
import type { RowStatus } from "@/lib/broadcast/watch";

export function ConfirmRing({ status, confirmations }: { status: string; confirmations: number }) {
  const known: RowStatus =
    status === "mempool" || status === "confirmed" || status === "missing" || status === "conflict" || status === "reorged"
      ? status
      : "missing";
  const gauge = confirmationGauge(known, confirmations);
  const turn = gauge.filled / 6;
  return (
    <div className={`confirm-gauge${gauge.alert ? " alert" : ""}`}>
      <div className="confirm-ring" style={{ ["--turn" as string]: String(turn) }}>
        <span>{gauge.filled}</span>
      </div>
      <p>{gauge.text}</p>
    </div>
  );
}
