/**
 * Add a Core-only OP_RETURN garnish to an unsigned one-input PSBT.
 * Runs locally. Does not sign, broadcast, or merge transactions.
 *
 * A signature commits to the outputs, so this must happen before the Coldcards sign.
 * Knots rejects a scriptPubKey longer than 83 bytes while reduced-data rules hold
 * (through 2027-09-01). Length and shape change per PSBT so the outputs do not share a pattern.
 */

import { Buffer } from "buffer";
import { Psbt, Transaction } from "bitcoinjs-lib";

export const MIN_WEDGE_SCRIPT_LEN = 84;
/** ScriptPubKey cap. Longer than Knots' 83-byte reduced-data limit, short enough for typical Core relay. */
export const MAX_WEDGE_SCRIPT_LEN = 120;
export const MIN_PAYLOAD_LEN = 85;
/** One OP_RETURN byte plus a two-byte push leaves this much data inside the script cap. */
export const MAX_PAYLOAD_LEN = MAX_WEDGE_SCRIPT_LEN - 3;
const DUST_SATS = 546;
const TEXT = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,;:-";

export const PAYLOAD_KINDS = ["bytes", "text", "hex", "pushes"] as const;
export type PayloadKind = (typeof PAYLOAD_KINDS)[number];

export type Wedge = {
  script: Buffer;
  kind: PayloadKind;
  dataBytes: number;
};

export type GarnishResult = {
  psbtBase64: string;
  scriptPubKeyLength: number;
  dataBytes: number;
  kind: PayloadKind;
  feeSatsBefore: number;
  feeSatsAfter: number;
  inputCount: number;
};

type TxCache = {
  __TX: { outs: { value: number; script: Buffer }[]; virtualSize: () => number };
  __FEE?: number;
  __FEE_RATE?: number;
  __EXTRACTED_TX?: unknown;
};

function cacheOf(psbt: Psbt): TxCache {
  return (psbt as unknown as { __CACHE: TxCache }).__CACHE;
}

function randomInt(min: number, max: number): number {
  const span = max - min + 1;
  const limit = Math.floor(0x100000000 / span) * span;
  const buf = new Uint32Array(1);
  let x = 0;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return min + (x % span);
}

function randomBytes(n: number): Buffer {
  const data = new Uint8Array(n);
  crypto.getRandomValues(data);
  return Buffer.from(data);
}

function randomText(n: number): Buffer {
  const raw = randomBytes(n);
  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) out[i] = TEXT.charCodeAt(raw[i] % TEXT.length);
  return out;
}

function pushChunk(data: Buffer): Buffer {
  if (data.length < 1 || data.length > 255) {
    throw new Error("OP_RETURN push must be 1 to 255 bytes");
  }
  if (data.length <= 75) return Buffer.concat([Buffer.from([data.length]), data]);
  return Buffer.concat([Buffer.from([0x4c, data.length]), data]);
}

export function opReturnScript(data: Buffer | Buffer[]): Buffer {
  const parts = Array.isArray(data) ? data : [data];
  if (parts.length < 1) throw new Error("OP_RETURN needs data");
  return Buffer.concat([Buffer.from([0x6a]), ...parts.map(pushChunk)]);
}

function hexPayload(n: number): Buffer {
  let even = n % 2 === 0 ? n : n + 1;
  if (even > MAX_PAYLOAD_LEN) even -= 2;
  return Buffer.from(randomBytes(even / 2).toString("hex"), "ascii");
}

function pushPayload(n: number): Buffer[] {
  const count = randomInt(2, 3);
  const sizes: number[] = [];
  let left = n;
  for (let i = 0; i < count - 1; i++) {
    const remain = count - 1 - i;
    const max = left - remain;
    const size = i === 0 ? randomInt(4, Math.min(16, max)) : randomInt(1, max);
    sizes.push(size);
    left -= size;
  }
  sizes.push(left);
  return sizes.map((size, i) => (i === 0 ? randomText(size) : randomBytes(size)));
}

function payloadFor(kind: PayloadKind, n: number): Buffer | Buffer[] {
  if (kind === "bytes") return randomBytes(n);
  if (kind === "text") return randomText(n);
  if (kind === "hex") return hexPayload(n);
  return pushPayload(n);
}

/** Kind rotates with index. The scriptPubKey stays within 84 through 120 bytes. */
export function nextWedge(index: number): Wedge {
  const kind = PAYLOAD_KINDS[Math.abs(index) % PAYLOAD_KINDS.length];
  let n = randomInt(MIN_PAYLOAD_LEN, MAX_PAYLOAD_LEN);
  while (n >= MIN_PAYLOAD_LEN) {
    const data = payloadFor(kind, n);
    const script = opReturnScript(data);
    const dataBytes = Array.isArray(data) ? data.reduce((sum, part) => sum + part.length, 0) : data.length;
    if (script.length >= MIN_WEDGE_SCRIPT_LEN && script.length <= MAX_WEDGE_SCRIPT_LEN) {
      return { script, kind, dataBytes };
    }
    n -= 1;
  }
  throw new Error("OP_RETURN script could not be kept within 120 bytes.");
}

export function wedgeCycleStart(): number {
  return randomInt(0, 0xffffffff);
}

export function outputVbytes(script: Buffer): number {
  const lenBytes = script.length < 253 ? 1 : 3;
  return 8 + lenBytes + script.length;
}

function parsePsbt(bytes: Buffer): Psbt {
  if (bytes.length >= 5 && bytes.subarray(0, 4).toString("ascii") === "psbt") {
    return Psbt.fromBuffer(bytes);
  }
  const text = bytes.toString("utf8").trim();
  if (!text) throw new Error("That file was empty.");
  try {
    return Psbt.fromBase64(text);
  } catch {
    throw new Error("Scoop could not read that as a PSBT.");
  }
}

function hasSignature(input: {
  partialSig?: unknown[];
  finalScriptSig?: Buffer;
  finalScriptWitness?: Buffer;
  tapKeySig?: Buffer;
  tapScriptSig?: unknown[];
}): boolean {
  return Boolean(
    input.partialSig?.length ||
      input.finalScriptSig?.length ||
      input.finalScriptWitness?.length ||
      input.tapKeySig?.length ||
      input.tapScriptSig?.length
  );
}

function inputValue(psbt: Psbt, index: number): number {
  const input = psbt.data.inputs[index];
  if (input.witnessUtxo) return input.witnessUtxo.value;
  if (input.nonWitnessUtxo) {
    const prev = Transaction.fromBuffer(input.nonWitnessUtxo);
    const vout = psbt.txInputs[index].index;
    const out = prev.outs[vout];
    if (!out) throw new Error("The previous output is not in this PSBT.");
    return out.value;
  }
  throw new Error(
    "This PSBT has no previous output amount. Export it from Sparrow with the input included."
  );
}

export function garnishUnsignedPsbt(bytes: Uint8Array, wedge: Wedge = nextWedge(wedgeCycleStart())): GarnishResult {
  const psbt = parsePsbt(Buffer.from(bytes));
  if (psbt.inputCount !== 1) {
    throw new Error(
      `This PSBT spends ${psbt.inputCount} inputs. Scoop garnishes one coin at a time and does not join them.`
    );
  }
  if (psbt.data.inputs.some((input) => hasSignature(input))) {
    throw new Error("This PSBT is already signed. Add the OP_RETURN before the Coldcards sign.");
  }

  const script = wedge.script;
  if (script.length < MIN_WEDGE_SCRIPT_LEN || script[0] !== 0x6a) {
    throw new Error("OP_RETURN script is shorter than 84 bytes.");
  }
  if (script.length > MAX_WEDGE_SCRIPT_LEN) {
    throw new Error("OP_RETURN script is longer than 120 bytes.");
  }
  if (psbt.txOutputs.some((out) => out.script.length > 0 && out.script[0] === 0x6a)) {
    throw new Error("This PSBT already has an OP_RETURN output.");
  }
  const payable = psbt.txOutputs
    .map((out, index) => ({ out, index }))
    .filter((row) => row.out.value > 0);
  if (payable.length !== 1) {
    throw new Error(
      "This PSBT needs exactly one payment output. A second output is change or a mix, and Scoop will not pick which coin loses the fee."
    );
  }

  const inputSats = inputValue(psbt, 0);
  const outputSats = psbt.txOutputs.reduce((sum, out) => sum + out.value, 0);
  const feeBefore = inputSats - outputSats;
  if (feeBefore < 0) throw new Error("The outputs already spend more than the input.");

  const vsize = Math.max(1, cacheOf(psbt).__TX.virtualSize());
  const rate = feeBefore / vsize;
  const extraVb = outputVbytes(script);
  const extraFee = Math.max(extraVb, Math.ceil(extraVb * rate));
  const pay = payable[0];
  const nextValue = pay.out.value - extraFee;
  if (nextValue < DUST_SATS) {
    throw new Error("The payment would be below dust after the extra fee for the OP_RETURN.");
  }

  const cache = cacheOf(psbt);
  cache.__TX.outs[pay.index].value = nextValue;
  cache.__FEE = undefined;
  cache.__FEE_RATE = undefined;
  cache.__EXTRACTED_TX = undefined;
  psbt.addOutput({ script, value: 0 });

  const feeAfter = inputSats - psbt.txOutputs.reduce((sum, out) => sum + out.value, 0);
  const added = psbt.txOutputs.find((out) => out.script.length > 0 && out.script[0] === 0x6a);
  if (!added || added.script.length < MIN_WEDGE_SCRIPT_LEN) {
    throw new Error("The OP_RETURN was not added.");
  }
  return {
    psbtBase64: psbt.toBase64(),
    scriptPubKeyLength: added.script.length,
    dataBytes: wedge.dataBytes,
    kind: wedge.kind,
    feeSatsBefore: feeBefore,
    feeSatsAfter: feeAfter,
    inputCount: 1,
  };
}
