"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, Candy, Cherry, IceCreamCone } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { href: "/", label: "Neapolitan", Icon: IceCreamCone },
  { href: "/flavor/core", label: "Core", Icon: Cherry },
  { href: "/flavor/knots", label: "Knots", Icon: Candy },
  { href: "/spills", label: "Spills", Icon: AlertTriangle },
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
        <p className="scoop-tagline">Read-only dual-tip coin catalog. No keys. No broadcast.</p>
        <ThemeToggle />
      </header>
      <nav className="scoop-nav" aria-label="Modes">
        {NAV.map(({ href, label, Icon }) => {
          const active = path === href || (href !== "/" && path.startsWith(href));
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
