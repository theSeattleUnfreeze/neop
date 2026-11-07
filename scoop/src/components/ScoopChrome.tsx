"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  ClipboardList,
  GitFork,
  HardDrive,
  IceCreamCone,
  LayoutDashboard,
  Server,
  Stamp,
  Wallet,
} from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { href: "/", label: "Dashboard", Icon: LayoutDashboard, exact: true },
  { href: "/stack", label: "Stack", Icon: Server },
  { href: "/wallets", label: "Wallets", Icon: Wallet },
  { href: "/splits", label: "Splits", Icon: GitFork },
  { href: "/garnish", label: "Garnish", Icon: Stamp },
  { href: "/howto", label: "How to", Icon: BookOpen },
  { href: "/tasks", label: "Tasks", Icon: ClipboardList },
  { href: "/backup", label: "Backup", Icon: HardDrive },
];

export function ScoopChrome({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="scoop-shell">
      <header className="scoop-header">
        <div className="scoop-brand">
          <IceCreamCone size={28} strokeWidth={2.25} aria-hidden />
          <div>
            <p className="scoop-kicker">Neapolitan</p>
            <h1>Scoop</h1>
          </div>
        </div>
        <p className="scoop-tagline">
          Dual-tip catalog on localhost. No keys. The Stack page can start the local node and indexer.
        </p>
        <ThemeToggle />
      </header>
      <nav className="scoop-nav" aria-label="Modes">
        {NAV.map(({ href, label, Icon, exact }) => {
          const active = exact
            ? path === href
            : path === href || path.startsWith(href + "/");
          return (
            <Link key={href} href={href} className={active ? "is-active" : undefined}>
              <Icon size={18} strokeWidth={2.25} aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
      <p className="scoop-backup-note">
        Wallets live in Scoop’s local database. Clearing this browser does not remove them.{" "}
        <Link href="/backup">Save an encrypted backup</Link> on your disk so you can restore them.
      </p>
      <p className="scoop-ln-note muted">
        Lightning channels: follow the{" "}
        <a
          href="https://gist.github.com/chrisguida/819e2725927e49934a583184b222bc71"
          target="_blank"
          rel="noopener noreferrer"
        >
          BLAKE2b Lightning rescue plan
        </a>{" "}
        (external SoT). Scoop catalogs wallet UTXOs only.
      </p>
      <main className="scoop-main">{children}</main>
    </div>
  );
}
