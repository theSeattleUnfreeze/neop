import type { Tip } from "@/lib/catalog/presence";

export const DEFAULT_EXPLORER_CORE = "https://mempool.space";
export const DEFAULT_EXPLORER_KNOTS = "https://mempool.guide";

export type ExplorerBases = {
  core: string;
  knots: string;
};

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Normalize an operator-supplied explorer base (scheme required). Empty → "". */
export function normalizeExplorerBase(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return stripTrailingSlash(parsed.toString());
  } catch {
    return "";
  }
}

/**
 * Resolve Core / Knots explorer bases.
 * Precedence: env → stack explorers argument → defaults (mempool.space / mempool.guide).
 */
export function resolveExplorerBases(
  env: NodeJS.ProcessEnv = process.env,
  stackExplorers?: { core?: string; knots?: string } | null
): ExplorerBases {
  const core =
    normalizeExplorerBase(env.SCOOP_EXPLORER_CORE) ||
    normalizeExplorerBase(stackExplorers?.core) ||
    DEFAULT_EXPLORER_CORE;
  const knots =
    normalizeExplorerBase(env.SCOOP_EXPLORER_KNOTS) ||
    normalizeExplorerBase(stackExplorers?.knots) ||
    DEFAULT_EXPLORER_KNOTS;
  return { core, knots };
}

/** Transaction page on a mempool-style explorer. */
export function txExplorerUrl(base: string, txid: string): string {
  const clean = normalizeExplorerBase(base) || base.replace(/\/+$/, "");
  return `${clean}/tx/${txid.toLowerCase()}`;
}

export function explorerBaseForTip(bases: ExplorerBases, tip: Tip): string {
  return tip === "core" ? bases.core : bases.knots;
}

export function defaultExplorerForTip(tip: Tip): string {
  return tip === "core" ? DEFAULT_EXPLORER_CORE : DEFAULT_EXPLORER_KNOTS;
}

/** True when the resolved base is still the Scoop public default for that tip. */
export function isPublicExplorer(tip: Tip, base: string): boolean {
  return normalizeExplorerBase(base) === normalizeExplorerBase(defaultExplorerForTip(tip));
}

export function explorerLabelForTip(tip: Tip, base: string): string {
  try {
    const host = new URL(base).host;
    return host || (tip === "core" ? "Core explorer" : "Knots explorer");
  } catch {
    return tip === "core" ? "Core explorer" : "Knots explorer";
  }
}
