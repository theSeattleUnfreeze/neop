/**
 * Wallet activity from Electrum tip state.
 * Received = confirming height/time of a live unspent outpoint.
 * Sent = confirming height/time of a spent marker (the spend that cleared it).
 */

export type ActivityStamp = {
  height: number | null;
  at: Date | null;
};

export type TipActivity = {
  status: "unspent" | "spent" | "absent";
  confirmedHeight?: number | null;
  confirmedAt?: Date | string | null;
};

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

function better(a: ActivityStamp, b: ActivityStamp): ActivityStamp {
  if (b.at && (!a.at || b.at.getTime() > a.at.getTime())) return b;
  if (!a.at && !b.at) {
    if (b.height != null && (a.height == null || b.height > a.height)) return b;
  }
  return a;
}

/** Prefer a confirmed receive time from either tip; mempool stays null. */
export function receivedStamp(core: TipActivity, knots: TipActivity): ActivityStamp {
  let best: ActivityStamp = { height: null, at: null };
  for (const tip of [core, knots]) {
    if (tip.status !== "unspent") continue;
    const height = tip.confirmedHeight != null && tip.confirmedHeight > 0 ? tip.confirmedHeight : null;
    best = better(best, { height, at: asDate(tip.confirmedAt) });
  }
  return best;
}

export function activityFromTipStates(
  states: TipActivity[]
): { lastReceived: ActivityStamp; lastSent: ActivityStamp } {
  let lastReceived: ActivityStamp = { height: null, at: null };
  let lastSent: ActivityStamp = { height: null, at: null };
  for (const tip of states) {
    const height = tip.confirmedHeight != null && tip.confirmedHeight > 0 ? tip.confirmedHeight : null;
    const at = asDate(tip.confirmedAt);
    if (tip.status === "unspent") lastReceived = better(lastReceived, { height, at });
    if (tip.status === "spent") lastSent = better(lastSent, { height, at });
  }
  return { lastReceived, lastSent };
}

export function formatActivityStamp(
  stamp: { height: number | null; at: Date | string | null } | null | undefined
): string {
  if (!stamp) return "—";
  const at = asDate(stamp.at);
  if (at) {
    return at.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  if (stamp.height != null) return `block ${stamp.height.toLocaleString()}`;
  return "—";
}
