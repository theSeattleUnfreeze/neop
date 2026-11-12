/** Read a PSBT enough to classify it. Callers must not log the bytes, the txid, or the address. */

import { Psbt, Transaction, address, networks, type Network } from "bitcoinjs-lib";
import { assignFlavor, guessFlavor, type CoinNeed, type FlavorGuess } from "@/lib/broadcast/pairWave";

const NET: Network = networks.bitcoin;

export type InspectedPsbt = {
  name: string;
  guess: FlavorGuess;
  inputCount: number;
  outpoints: string[];
  addresses: string[];
  txid: string | null;
  hex: string | null;
};

function outpoint(hash: Buffer, vout: number): string {
  return `${Buffer.from(hash).reverse().toString("hex")}:${vout}`;
}

function scriptAddress(script: Buffer | undefined): string | null {
  if (!script || script.length === 0) return null;
  try {
    return address.fromOutputScript(script, NET);
  } catch {
    return null;
  }
}

export function inputAddresses(psbt: Psbt): string[] {
  const found: string[] = [];
  psbt.data.inputs.forEach((input, index) => {
    const witness = input.witnessUtxo?.script;
    if (witness) {
      const value = scriptAddress(witness);
      if (value) found.push(value);
      return;
    }
    const prev = input.nonWitnessUtxo;
    const vin = psbt.txInputs[index];
    if (!prev || !vin) return;
    const prevTx = Transaction.fromBuffer(prev);
    const value = scriptAddress(prevTx.outs[vin.index]?.script);
    if (value) found.push(value);
  });
  return found;
}

function inputIsFinal(psbt: Psbt): boolean {
  return psbt.data.inputs.length > 0 && psbt.data.inputs.every((input) => input.finalScriptSig || input.finalScriptWitness);
}

/** A file that already carries final scripts must not be finalized again. bitcoinjs-lib throws when those fields are set. */
function signedTx(psbt: Psbt): Transaction | null {
  try {
    return (inputIsFinal(psbt) ? psbt : psbt.finalizeAllInputs()).extractTransaction();
  } catch {
    return null;
  }
}

export function inspectPsbt(name: string, bytes: Uint8Array, needs: CoinNeed[] = []): InspectedPsbt {
  const psbt = Psbt.fromBuffer(Buffer.from(bytes), { network: NET });
  const addresses = inputAddresses(psbt);
  const outpoints = psbt.txInputs.map((input) => outpoint(input.hash, input.index));
  const extracted = signedTx(psbt);
  const guess = assignFlavor(extracted ? guessFlavor(extracted) : { flavor: null, why: "This file has no signature." }, needs);
  return {
    name,
    guess,
    inputCount: psbt.txInputs.length,
    outpoints,
    addresses,
    txid: extracted ? extracted.getId() : null,
    hex: extracted ? extracted.toHex() : null,
  };
}

export function inspectBase64(name: string, b64: string, needs: CoinNeed[] = []): InspectedPsbt {
  return inspectPsbt(name, Buffer.from(b64, "base64"), needs);
}
