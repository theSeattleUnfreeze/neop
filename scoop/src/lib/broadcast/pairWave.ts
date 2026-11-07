/**
 * Flavor, pairing, and wave order for a same-wave split.
 * No network and no wallet material. A failed pair must not send.
 */

import { hasCoreWedge, sighashes, SIGHASH_ALL_UNIFIED, type TxLike } from "@/lib/broadcast/wave";

/** Reduced-data OP_RETURN rule ends at this instant. */
export const RDTS_EXPIRY_MS = Date.UTC(2027, 8, 1, 0, 0, 0);
export const RDTS_WARN_LEAD_MS = 7 * 24 * 60 * 60 * 1000;

export type Flavor = "core" | "knots";

export type FlavorWhy = "long-op-return" | "unified-sighash" | "sighash-all" | "knots-absent";

export type CoinNeed = "needs-split" | "core-only" | "knots-only" | "unknown";

/** Both tips must be present. One tip alone is not enough to call a coin safe. */
export function coinNeedFromStatus(core?: string | null, knots?: string | null): CoinNeed {
  if (!core || !knots) return "unknown";
  const coreLive = core === "unspent";
  const knotsLive = knots === "unspent";
  if (coreLive && knotsLive) return "needs-split";
  if (coreLive) return "core-only";
  if (knotsLive) return "knots-only";
  return "unknown";
}

export type FlavorGuess =
  | { flavor: Flavor; why: FlavorWhy }
  | { flavor: null; why: string };

export type SignedFile = {
  name: string;
  flavor: Flavor | null;
  why: string;
  inputCount: number;
  outpoints: string[];
};

export type PairProblem = {
  message: string;
};

const SIGHASH_ALL = 0x01;

function unified(byte: number): boolean {
  return byte === SIGHASH_ALL_UNIFIED || (byte & 0x20) !== 0;
}

/** Classify from the signed transaction alone. Catalog can still relabel a knots-absent Core file. */
export function guessFlavor(tx: TxLike): FlavorGuess {
  const hashes = sighashes(tx);
  if (hashes.length === 0) return { flavor: null, why: "This file has no signature." };
  const hasUnified = hashes.some(unified);
  const longOp = hasCoreWedge(tx);
  if (hasUnified && longOp) {
    return { flavor: null, why: "This file has unified sighash and a long OP_RETURN." };
  }
  if (hasUnified) {
    if (hashes.some((byte) => !unified(byte))) {
      return { flavor: null, why: "This file mixes unified sighash with another sighash." };
    }
    return { flavor: "knots", why: "unified-sighash" };
  }
  if (hashes.some((byte) => byte !== SIGHASH_ALL)) {
    return { flavor: null, why: "This file's signature is not SIGHASH_ALL." };
  }
  if (longOp) return { flavor: "core", why: "long-op-return" };
  return { flavor: "knots", why: "sighash-all" };
}

/**
 * A SIGHASH_ALL file with no long OP_RETURN is Knots unless every input is
 * already gone from Knots. Then it is the Core file that does not need a garnish.
 */
export function assignFlavor(guess: FlavorGuess, needs: CoinNeed[]): FlavorGuess {
  if (!guess.flavor) return guess;
  if (guess.why !== "sighash-all") return guess;
  if (needs.length > 0 && needs.every((need) => need === "core-only")) {
    return { flavor: "core", why: "knots-absent" };
  }
  return guess;
}

export function pairWave(
  files: SignedFile[],
  catalog: Record<string, CoinNeed>
): { ok: boolean; problems: PairProblem[] } {
  const problems: PairProblem[] = [];
  if (files.length === 0) {
    return { ok: false, problems: [{ message: "No signed files." }] };
  }
  for (const file of files) {
    if (!file.flavor) {
      problems.push({ message: `${file.name}: ${file.why}` });
      continue;
    }
    if (file.inputCount < 1) {
      problems.push({ message: `${file.name} has no inputs.` });
    }
    if (file.flavor === "knots" && file.inputCount !== 1) {
      problems.push({ message: `${file.name} spends ${file.inputCount} inputs. The Knots wave is one coin per transaction.` });
    }
    if (file.flavor === "core" && file.why !== "knots-absent" && file.inputCount !== 1) {
      problems.push({ message: `${file.name} spends ${file.inputCount} inputs. The Core wave is one coin per transaction.` });
    }
  }

  const byPoint = new Map<string, SignedFile[]>();
  for (const file of files) {
    if (!file.flavor) continue;
    for (const point of file.outpoints) {
      const list = byPoint.get(point) ?? [];
      list.push(file);
      byPoint.set(point, list);
    }
  }

  for (const [point, group] of byPoint) {
    const need = catalog[point] ?? "unknown";
    const cores = group.filter((file) => file.flavor === "core");
    const knots = group.filter((file) => file.flavor === "knots");
    if (need === "unknown") {
      problems.push({
        message: "Scoop does not know this coin, so it cannot tell whether a spend of it can be replayed.",
      });
      continue;
    }
    if (need === "needs-split") {
      if (cores.length !== 1 || knots.length !== 1) {
        problems.push({
          message: "A coin that is still unspent on both chains needs exactly one Core file and one Knots file.",
        });
      }
      continue;
    }
    if (need === "core-only") {
      if (cores.length !== 1 || knots.length !== 0) {
        problems.push({
          message: "A coin Knots no longer has needs one Core file and no Knots file.",
        });
      }
      continue;
    }
    if (knots.length !== 1 || cores.length !== 0) {
      problems.push({
        message: "A coin Core no longer has needs one Knots file and no Core file.",
      });
    }
  }

  return { ok: problems.length === 0, problems };
}

export type WavePhase = "hold" | "send-knots" | "done";

/**
 * Wave 2 starts only when every Core input is spent in a block.
 * No Core files means there is nothing to wait for.
 * A null spent flag is not proof.
 */
/** One unproven gettxout keeps the whole Core wave unproven. */
export function coreInputsSpent(flags: (boolean | null)[]): boolean | null {
  if (flags.length === 0) return true;
  if (flags.some((flag) => flag === null)) return null;
  return flags.every((flag) => flag);
}

export function nextWave(input: {
  coreFileCount: number;
  coreInputsSpent: boolean | null;
  knotsSent: boolean;
}): { phase: WavePhase; reason: string } {
  if (input.knotsSent) return { phase: "done", reason: "Knots wave already sent." };
  if (input.coreFileCount > 0 && input.coreInputsSpent !== true) {
    return {
      phase: "hold",
      reason:
        input.coreInputsSpent === false
          ? "A Core input is still unspent. Knots stays unsent."
          : "Core has not shown those inputs spent in a block. Knots stays unsent.",
    };
  }
  return { phase: "send-knots", reason: "Core inputs are spent in a block. Knots can be sent." };
}

export function rdtsWarning(nowMs: number, knotsMedianTimeSec: number | null): { warn: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!Number.isFinite(nowMs)) return { warn: false, reasons };
  if (nowMs >= RDTS_EXPIRY_MS - RDTS_WARN_LEAD_MS) {
    reasons.push(
      nowMs >= RDTS_EXPIRY_MS
        ? "The reduced-data rule expired on 2027-09-01. A long OP_RETURN no longer keeps a Core transaction off Knots."
        : "The reduced-data rule expires within a week (2027-09-01). A long OP_RETURN will stop keeping a Core transaction off Knots."
    );
  }
  if (knotsMedianTimeSec !== null && Number.isFinite(knotsMedianTimeSec) && knotsMedianTimeSec * 1000 >= RDTS_EXPIRY_MS) {
    reasons.push("The Knots tip's median time is at or past 2027-09-01. A long OP_RETURN is not replay protection.");
  }
  return { warn: reasons.length > 0, reasons };
}

export function flavorReason(why: string): string {
  switch (why) {
    case "long-op-return":
      return "Long OP_RETURN. This is the Core file, while the reduced-data rule holds.";
    case "unified-sighash":
      return "Unified sighash. This is the Knots file.";
    case "sighash-all":
      return "SIGHASH_ALL and no long OP_RETURN. This is the Knots file. It can replay onto Core if it is broadcast first.";
    case "knots-absent":
      return "Knots no longer has these inputs, so this Core file has no long OP_RETURN.";
    default:
      return why;
  }
}

export function needReason(need: CoinNeed | "mixed"): string {
  switch (need) {
    case "needs-split":
      return "Still unspent on both chains. Needs one Core file and one Knots file.";
    case "core-only":
      return "Knots no longer has this coin.";
    case "knots-only":
      return "Core no longer has this coin.";
    case "mixed":
      return "This file spends coins that are not in the same situation.";
    default:
      return "Scoop does not know this coin, so it cannot tell whether a spend can be replayed.";
  }
}

export type PreviewInput = {
  name: string;
  guess: FlavorGuess;
  inputCount: number;
  outpoints: string[];
};

export type PreviewRow = {
  name: string;
  flavor: Flavor | null;
  why: string;
  whyKey: string;
  inputCount: number;
  need: CoinNeed | "mixed";
  needText: string;
};

export function assemblePreview(
  files: PreviewInput[],
  catalog: Record<string, CoinNeed>
): { rows: PreviewRow[]; problems: PairProblem[]; pairOk: boolean } {
  const signed: SignedFile[] = [];
  const rows: PreviewRow[] = files.map((file) => {
    const needs = file.outpoints.map((point) => catalog[point] ?? "unknown");
    const assigned = assignFlavor(file.guess, needs);
    const distinct = [...new Set(needs)];
    const need: CoinNeed | "mixed" = distinct.length === 1 ? distinct[0] : distinct.length === 0 ? "unknown" : "mixed";
    signed.push({
      name: file.name,
      flavor: assigned.flavor,
      why: assigned.why,
      inputCount: file.inputCount,
      outpoints: file.outpoints,
    });
    return {
      name: file.name,
      flavor: assigned.flavor,
      why: flavorReason(assigned.why),
      whyKey: assigned.why,
      inputCount: file.inputCount,
      need,
      needText: needReason(need),
    };
  });
  const paired = pairWave(signed, catalog);
  return { rows, problems: paired.problems, pairOk: paired.ok };
}

/** The Core request sends only Core files. The Knots request sends only Knots files. */
export function filesForPhase<T extends { flavor: Flavor | null }>(
  files: T[],
  phase: Flavor
): { ok: boolean; files: T[]; reason: string } {
  const picked = files.filter((file) => file.flavor === phase);
  if (picked.length === 0) {
    return { ok: false, files: [], reason: `This wave has no ${phase === "core" ? "Core" : "Knots"} files.` };
  }
  return { ok: true, files: picked, reason: "" };
}

/** After the first accept, a later failure must not say that nothing was sent. */
export function sendStoppedReason(phase: Flavor, accepted: number): string {
  if (accepted < 1) return "Nothing sent.";
  if (phase === "core") return "A Core transaction was already accepted. It cannot be taken back.";
  return "A Knots transaction was already accepted.";
}

/** Send stays off until every file is checked and the pair is clean. */
export function maySendWave1(input: {
  fileCount: number;
  checkedCount: number;
  pairOk: boolean;
}): { ok: boolean; reason: string } {
  if (!input.pairOk) return { ok: false, reason: "The files do not form a complete wave." };
  if (input.fileCount < 1) return { ok: false, reason: "No signed files." };
  if (input.checkedCount !== input.fileCount) {
    return { ok: false, reason: "Check every transaction before sending. A Core send cannot be taken back." };
  }
  return { ok: true, reason: "Ready to send the Core wave." };
}
