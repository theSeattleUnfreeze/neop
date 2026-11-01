"use client";

import Link from "next/link";

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
  lastSyncedAt?: string | null;
};

function fmtSats(s: string) {
  try {
    return BigInt(s).toLocaleString() + " sats";
  } catch {
    return s;
  }
}

export function AccountCard(props: Props) {
  return (
    <Link href={`/wallets/${props.id}`} className="account-card">
      <div className="account-card-top">
        <h3>{props.label}</h3>
        <span className={`source-pill ${props.source}`}>{props.source}</span>
      </div>
      {props.reminder ? <p className="muted reminder">{props.reminder}</p> : null}
      <div className="balance-row">
        <span className="presence-chip core">Core {fmtSats(props.coreSats)}</span>
        <span className="presence-chip knots">Knots {fmtSats(props.knotsSats)}</span>
      </div>
      <div className="account-meta">
        {props.bothCount > 0 ? (
          <span className="presence-chip both">{props.bothCount} both</span>
        ) : null}
        {props.openTaskCount > 0 ? (
          <span className="meta-badge">{props.openTaskCount} tasks</span>
        ) : null}
        {props.unreadNotificationCount > 0 ? (
          <span className="meta-badge alert">{props.unreadNotificationCount} alerts</span>
        ) : null}
        {props.estimate ? <span className="muted">estimate</span> : null}
      </div>
      {props.lastSyncedAt ? (
        <p className="muted tiny">Synced {new Date(props.lastSyncedAt).toLocaleString()}</p>
      ) : props.source === "electrum" ? (
        <p className="muted tiny">Not synced yet</p>
      ) : null}
    </Link>
  );
}
