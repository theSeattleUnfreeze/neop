"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeMode } from "@/lib/theme/ThemeProvider";

const OPTIONS: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: "light", label: "Light", Icon: Sun },
  { mode: "dark", label: "Dark", Icon: Moon },
  { mode: "system", label: "System", Icon: Monitor },
];

export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  return (
    <div className="theme-toggle" role="group" aria-label="Color theme">
      {OPTIONS.map(({ mode: m, label, Icon }) => (
        <button
          key={m}
          type="button"
          className={mode === m ? "is-active" : undefined}
          onClick={() => setMode(m)}
          aria-pressed={mode === m}
          title={label}
        >
          <Icon size={16} strokeWidth={2.25} aria-hidden />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
