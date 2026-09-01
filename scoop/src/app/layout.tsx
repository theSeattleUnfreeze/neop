import type { Metadata } from "next";
import { DM_Mono, Fraunces } from "next/font/google";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ScoopChrome } from "@/components/ScoopChrome";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  weight: ["500", "700"],
});

const mono = DM_Mono({
  subsets: ["latin"],
  variable: "--font-dm-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Scoop — Neapolitan read-only wallet",
  description: "Catalog Core and Knots UTXO presence, movement, and likely replays.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${display.variable} ${mono.variable}`}>
        <ThemeProvider>
          <ScoopChrome>{children}</ScoopChrome>
        </ThemeProvider>
      </body>
    </html>
  );
}
