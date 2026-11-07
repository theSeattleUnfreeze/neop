"use client";

import Link from "next/link";
import { formatActivityStamp } from "@/lib/catalog/activity";

type ActivityStampJson = { height: number | null; at: string | null };

type Props = {
  id: number;
  label: string;
  reminder?: string;
  source: "manual" | "electrum";
  coreSats: string;
  knotsSats: string;
  bothCount: number;
  openTaskCount: number;
  unreadNotificationCount: number;
  estimate: boolean;
  coreKnown?: boolean;
  knotsKnown?: boolean;
  lastSyncedAt?: string | null;
  lastReceived?: ActivityStampJson | null;
  lastSent?: ActivityStampJson | null;
};

function fmtSats(s: string) {
  try {
    return BigInt(s).toLocaleString() + " sats";
  } catch {
    return s;
  }
}

function tipLabel(known: boolean | undefined, sats: string, estimate: boolean) {
  if (estimate || known !== false) return fmtSats(sats);
  return "unknown";
}

export function AccountCard(props: Props) {
  const tipGap = !props.estimate && (props.coreKnown === false || props.knotsKnown === false);
  return (
    <Link href={`/wallets/${props.id}`} className="account-card">
      <div className="account-card-top">
        <h3>{props.label}</h3>
        <span className={`source-pill ${props.source}`}>{props.source}</span>
      </div>
      {props.reminder ? <p className="muted reminder">{props.reminder}</p> : null}
      <div className="balance-row">
        <span className={`presence-chip core${props.coreKnown === false ? " none" : ""}`}>
          Core {tipLabel(props.coreKnown, props.coreSats, props.estimate)}
        </span>
        <span className={`presence-chip knots${props.knotsKnown === false ? " none" : ""}`}>
          Knots {tipLabel(props.knotsKnown, props.knotsSats, props.estimate)}
        </span>
      </div>
      <div className="account-activity">
        <span>
          <span className="muted">Last received</span>{" "}
          {formatActivityStamp(props.lastReceived)}
        </span>
        <span>
          <span className="muted">Last sent</span>{" "}
          {formatActivityStamp(props.lastSent)}
        </span>
      </div>
      <div className="account-meta">
        {props.bothCount > 0 ? (
          <span className="presence-chip both">{props.bothCount} replay</span>
        ) : null}
        {props.openTaskCount > 0 ? (
          <span className="meta-badge">{props.openTaskCount} tasks</span>
        ) : null}
        {props.unreadNotificationCount > 0 ? (
          <span className="meta-badge alert">{props.unreadNotificationCount} alerts</span>
        ) : null}
        {props.estimate ? <span className="muted">estimate</span> : null}
        {tipGap ? <span className="muted">tip incomplete</span> : null}
      </div>
      {props.lastSyncedAt ? (
        <p className="muted tiny">Synced {new Date(props.lastSyncedAt).toLocaleString()}</p>
      ) : props.source === "electrum" ? (
        <p className="muted tiny">Not synced yet</p>
      ) : null}
    </Link>
  );
}
