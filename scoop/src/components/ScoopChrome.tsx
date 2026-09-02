"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  Candy,
  Cherry,
  ClipboardList,
  IceCreamCone,
  LayoutDashboard,
  Wallet,
} from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { href: "/", label: "Dashboard", Icon: LayoutDashboard, exact: true },
  { href: "/accounts", label: "Accounts", Icon: Wallet },
  { href: "/tasks", label: "Tasks", Icon: ClipboardList },
  { href: "/catalog", label: "Neapolitan", Icon: IceCreamCone },
  { href: "/catalog/flavor/core", label: "Core", Icon: Cherry },
  { href: "/catalog/flavor/knots", label: "Knots", Icon: Candy },
  { href: "/catalog/spills", label: "Spills", Icon: AlertTriangle },
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
          Self-hosted read-only dual-tip catalog. No keys. No broadcast. Localhost by default.
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
      <main className="scoop-main">{children}</main>
    </div>
  );
}
