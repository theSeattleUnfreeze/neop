/** How many receive addresses an xpub import watches by default. */
export const DEFAULT_GAP_LIMIT = 50;
export const MIN_GAP_LIMIT = 1;
export const MAX_GAP_LIMIT = 200;

export function clampGapLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_GAP_LIMIT;
  return Math.min(Math.max(Math.trunc(value), MIN_GAP_LIMIT), MAX_GAP_LIMIT);
}
