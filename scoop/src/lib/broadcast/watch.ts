/** Pure status rules for the post-send batch watcher. No network and no wallet material. */

export const MEAN_BLOCK_MINUTES = 10;

export type ChainBlock = { height: number; hash: string };

export type RowStatus = "mempool" | "confirmed" | "missing" | "conflict" | "reorged";

/** Probability a block interval lasts at least this many minutes. Mean is 10. */
export function blockGapOdds(minutes: number, meanMinutes = MEAN_BLOCK_MINUTES): number {
  if (!Number.isFinite(minutes) || minutes < 0) throw new Error("minutes must be non-negative");
  if (!Number.isFinite(meanMinutes) || meanMinutes <= 0) throw new Error("mean must be positive");
  return Math.exp(-minutes / meanMinutes);
}

export function feeRateSatPerVbyte(feeSats: number, vsize: number): number | null {
  if (!Number.isFinite(feeSats) || !Number.isFinite(vsize) || vsize <= 0) return null;
  return feeSats / vsize;
}

/** Heights whose stored hash is no longer the hash at that height. */
export function reorgedHeights(before: ChainBlock[], after: ChainBlock[]): number[] {
  const now = new Map(after.map((block) => [block.height, block.hash]));
  return before
    .filter((block) => {
      const hash = now.get(block.height);
      return hash !== undefined && hash !== block.hash;
    })
    .map((block) => block.height);
}

export function rowStatus(input: {
  ourTxid: string;
  inMempool: boolean;
  spenders: (string | null)[];
  confirmed: ChainBlock | null;
  hashAtConfirmedHeight: string | null;
}): RowStatus {
  const foreign = input.spenders.some((id) => id !== null && id !== input.ourTxid);
  const reorged =
    input.confirmed !== null &&
    input.hashAtConfirmedHeight !== null &&
    input.hashAtConfirmedHeight !== input.confirmed.hash;
  if (reorged) return "reorged";
  if (foreign) return "conflict";
  if (input.confirmed) return "confirmed";
  if (input.inMempool) return "mempool";
  return "missing";
}

export function freshIds(previous: ReadonlySet<string>, current: ReadonlySet<string>): string[] {
  return [...current].filter((id) => !previous.has(id));
}
