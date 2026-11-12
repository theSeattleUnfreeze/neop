/**
 * Match unsigned PSBTs to listed outpoints. The operator drops them anywhere on the page.
 */

import type { SplitMethod } from "@/lib/split/method";

export type DroppedUnsigned = {
  name: string;
  inputCount: number;
  outpoints: string[];
  signed: boolean;
};

export type SlotFile = { name: string };

export function classifyUnsigned(
  file: DroppedUnsigned,
  listed: ReadonlySet<string>
): { ok: true; outpoint: string } | { ok: false; reason: string } {
  if (file.signed) return { ok: false, reason: `${file.name} is already signed.` };
  if (file.inputCount !== 1 || file.outpoints.length !== 1) {
    return { ok: false, reason: `${file.name} spends ${file.inputCount} inputs. One coin per file.` };
  }
  const outpoint = file.outpoints[0].toLowerCase();
  if (!listed.has(outpoint)) return { ok: false, reason: `${file.name} spends a coin that is not in this list.` };
  return { ok: true, outpoint };
}

export function filesPerCoin(method: SplitMethod): number {
  return method === "drain" ? 2 : 1;
}

/** Attach one file. A second file replaces the first, except a drain keeps two. */
export function attachUnsigned<T extends SlotFile>(
  method: SplitMethod,
  slots: Record<string, T[]>,
  outpoint: string,
  file: T
): { slots: Record<string, T[]>; reason: string | null } {
  const key = outpoint.toLowerCase();
  const current = slots[key] ?? [];
  const without = current.filter((item) => item.name !== file.name);
  if (method !== "drain") {
    return { slots: { ...slots, [key]: [file] }, reason: null };
  }
  if (without.length >= 2) {
    return { slots, reason: `${file.name} was not kept. This coin already has two files.` };
  }
  return { slots: { ...slots, [key]: [...without, file] }, reason: null };
}

export function rowReady(method: SplitMethod, count: number): boolean {
  return count === filesPerCoin(method);
}

/** Which queued files receive an OP_RETURN. Unified sighash receives none. */
export function garnishTargets(
  method: SplitMethod,
  files: SlotFile[],
  coreName: string | null
): { ok: boolean; names: string[] } {
  if (method === "unified-sighash") return { ok: true, names: [] };
  if (method === "core-garnish") {
    return files.length === 1 ? { ok: true, names: files.map((file) => file.name) } : { ok: false, names: [] };
  }
  if (files.length !== 2 || !coreName || !files.some((file) => file.name === coreName)) {
    return { ok: false, names: [] };
  }
  return { ok: true, names: [coreName] };
}
