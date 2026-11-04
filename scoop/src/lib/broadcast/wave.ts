/**
 * Local checks for a same-wave Core / Knots broadcast.
 * No network. A failed check here means the sender must not transmit anything.
 *
 * These transactions are independent. Bitcoin will not accept or reject the set
 * as one package. The only all-or-nothing guarantee is the preflight: every
 * local check and every testmempoolaccept must pass before the first send.
 */

export const MAX_GAP_MS = 2000;
export const MIN_WEDGE_SCRIPT_LEN = 84;
export const SIGHASH_ALL_UNIFIED = 0x21;

export type TxLike = {
  ins: { script: Uint8Array; witness: Uint8Array[] }[];
  outs: { script: Uint8Array }[];
};

export type MempoolVerdict = {
  allowed: boolean;
  reason?: string;
};

/** Random gap before the next send on one chain. unitInterval is in [0, 1). */
export function jitterMs(unitInterval: number): number {
  if (!Number.isFinite(unitInterval) || unitInterval < 0 || unitInterval >= 1) {
    throw new Error("jitter unit interval must be in [0, 1)");
  }
  return Math.floor(unitInterval * (MAX_GAP_MS + 1));
}

function isOpReturnWedge(script: Uint8Array): boolean {
  return script.length >= MIN_WEDGE_SCRIPT_LEN && script[0] === 0x6a;
}

function derSighash(item: Uint8Array): number | null {
  if (item.length < 9 || item[0] !== 0x30) return null;
  if (item.length !== item[1] + 3) return null;
  return item[item.length - 1];
}

function pushSighash(data: Uint8Array, found: number[]) {
  const der = derSighash(data);
  if (der !== null) {
    found.push(der);
    return;
  }
  if (data.length === 65) found.push(data[64]);
}

function walkPushes(script: Uint8Array, found: number[]) {
  let i = 0;
  while (i < script.length) {
    const op = script[i];
    if (op === 0) {
      i += 1;
      continue;
    }
    if (op >= 1 && op <= 75) {
      pushSighash(script.subarray(i + 1, i + 1 + op), found);
      i += 1 + op;
      continue;
    }
    if (op === 0x4c && i + 1 < script.length) {
      const n = script[i + 1];
      pushSighash(script.subarray(i + 2, i + 2 + n), found);
      i += 2 + n;
      continue;
    }
    i += 1;
  }
}

export function sighashes(tx: TxLike): number[] {
  const found: number[] = [];
  for (const input of tx.ins) {
    for (const item of input.witness) pushSighash(item, found);
    walkPushes(input.script, found);
  }
  return found;
}

function inputProblem(tx: TxLike): string | null {
  if (tx.ins.length !== 1) {
    return `This transaction spends ${tx.ins.length} inputs. The wave is one coin per transaction.`;
  }
  return null;
}

export function hasCoreWedge(tx: TxLike): boolean {
  return tx.outs.some((out) => isOpReturnWedge(out.script));
}

/**
 * knotsAbsent is only for a Core transaction whose every input is already
 * missing from the Knots UTXO set. The caller has to have checked that.
 * Those transactions need no OP_RETURN, and they may spend more than one input.
 */
export function coreProblems(tx: TxLike, opts?: { knotsAbsent?: boolean }): string[] {
  const problems: string[] = [];
  if (opts?.knotsAbsent) {
    if (tx.ins.length < 1) problems.push("Core transaction has no inputs.");
  } else {
    const inputs = inputProblem(tx);
    if (inputs) problems.push(inputs);
    if (!hasCoreWedge(tx)) {
      problems.push("Core transaction has no OP_RETURN script longer than 83 bytes.");
    }
  }
  const hashes = sighashes(tx);
  if (hashes.length === 0) problems.push("Core transaction has no signature.");
  if (hashes.some((byte) => byte === SIGHASH_ALL_UNIFIED || (byte & 0x20) !== 0)) {
    problems.push("Core transaction carries unified sighash. That file belongs in the Knots batch.");
  }
  return problems;
}

/**
 * Knots transactions signed with SIGHASH_ALL. They are valid on Core until the
 * Core transactions that spend the same inputs have confirmed, so they are
 * broadcast only after that.
 */
export function knotsAfterCoreProblems(tx: TxLike): string[] {
  const problems: string[] = [];
  const inputs = inputProblem(tx);
  if (inputs) problems.push(inputs);
  if (hasCoreWedge(tx)) {
    problems.push("Knots transaction contains an OP_RETURN script longer than 83 bytes. That file belongs in the Core batch.");
  }
  const hashes = sighashes(tx);
  if (hashes.length === 0) problems.push("Knots transaction has no signature.");
  if (hashes.some((byte) => byte !== SIGHASH_ALL_UNIFIED && byte !== 0x01)) {
    problems.push("Knots transaction signature is not SIGHASH_ALL.");
  }
  return problems;
}

export function knotsProblems(tx: TxLike): string[] {
  const problems: string[] = [];
  const inputs = inputProblem(tx);
  if (inputs) problems.push(inputs);
  if (tx.outs.some((out) => isOpReturnWedge(out.script))) {
    problems.push("Knots transaction contains an OP_RETURN script longer than 83 bytes. That file belongs in the Core batch.");
  }
  const hashes = sighashes(tx);
  if (hashes.length === 0) problems.push("Knots transaction has no signature.");
  if (hashes.some((byte) => byte !== SIGHASH_ALL_UNIFIED)) {
    problems.push("Knots transaction is missing SIGHASH_ALL|UNIFIED (0x21) on a signature.");
  }
  return problems;
}

/** One row of Bitcoin Core testmempoolaccept. */
export function readMempoolAccept(result: unknown): MempoolVerdict {
  const row = Array.isArray(result) ? result[0] : result;
  if (!row || typeof row !== "object") {
    return { allowed: false, reason: "empty testmempoolaccept result" };
  }
  const rec = row as { allowed?: boolean; "reject-reason"?: string };
  const reason = rec["reject-reason"];
  return { allowed: rec.allowed === true, reason: typeof reason === "string" ? reason : undefined };
}

/**
 * Send only when every local check passed and every preflight allowed the tx.
 * An empty preflight list is a refusal: Electrum broadcast is not a substitute.
 */
export function mayBroadcast(localErrors: string[], verdicts: MempoolVerdict[]): { ok: true } | { ok: false; reason: string } {
  if (localErrors.length > 0) return { ok: false, reason: localErrors[0] };
  if (verdicts.length === 0) return { ok: false, reason: "no testmempoolaccept results" };
  const bad = verdicts.find((verdict) => !verdict.allowed);
  if (bad) return { ok: false, reason: bad.reason || "testmempoolaccept rejected a transaction" };
  return { ok: true };
}

/** Footer when the broadcast script aborts from an unexpected error. */
export function broadcastAbortFooter(sendKnots: boolean, coreAlreadySent: boolean): string {
  if (sendKnots) return "Knots not sent.";
  if (coreAlreadySent) return "Knots not sent.";
  return "Nothing sent.";
}
