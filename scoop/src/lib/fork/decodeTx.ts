import * as bitcoin from "bitcoinjs-lib";

export type DecodedOutput = {
  vout: number;
  valueSats: number;
  scriptHex: string;
  address: string | null;
  scriptLabel: string;
};

export type DecodedTx = {
  txid: string;
  inputs: { prevTxid: string; prevVout: number }[];
  outputs: DecodedOutput[];
};

/** Mainnet vs testnet from the watched script's own address, not a new setting. */
export function networkForAddress(address: string | null | undefined): bitcoin.Network | null {
  const a = (address ?? "").trim();
  if (!a) return null;
  const lower = a.toLowerCase();
  if (lower.startsWith("bcrt1")) return bitcoin.networks.regtest;
  if (lower.startsWith("tb1") || a.startsWith("m") || a.startsWith("n") || a.startsWith("2")) {
    return bitcoin.networks.testnet;
  }
  if (lower.startsWith("bc1") || a.startsWith("1") || a.startsWith("3")) {
    return bitcoin.networks.bitcoin;
  }
  return null;
}

export function scriptLabelOf(script: Buffer): string {
  if (script.length > 0 && script[0] === 0x6a) return "op_return";
  if (script.length === 22 && script[0] === 0x00 && script[1] === 0x14) return "p2wpkh";
  if (script.length === 34 && script[0] === 0x00 && script[1] === 0x20) return "p2wsh";
  if (script.length === 34 && script[0] === 0x51 && script[1] === 0x20) return "p2tr";
  if (script.length === 23 && script[0] === 0xa9 && script[22] === 0x87) return "p2sh";
  if (script.length === 25 && script[0] === 0x76 && script[1] === 0xa9) return "p2pkh";
  return "unknown";
}

function addressFromScript(script: Buffer, hint: string | null): string | null {
  const preferred = networkForAddress(hint);
  const networks = preferred
    ? [preferred]
    : [bitcoin.networks.bitcoin, bitcoin.networks.testnet, bitcoin.networks.regtest];
  for (const network of networks) {
    try {
      return bitcoin.address.fromOutputScript(script, network);
    } catch {
      /* try the next network */
    }
  }
  return null;
}

export function decodeTransaction(hex: string, addressHint: string | null = null): DecodedTx {
  const tx = bitcoin.Transaction.fromHex(hex.trim());
  return {
    txid: tx.getId(),
    inputs: tx.ins.map((input) => ({
      prevTxid: Buffer.from(input.hash).reverse().toString("hex"),
      prevVout: input.index,
    })),
    outputs: tx.outs.map((out, vout) => {
      const script = Buffer.from(out.script);
      return {
        vout,
        valueSats: Number(out.value),
        scriptHex: script.toString("hex"),
        address: addressFromScript(script, addressHint),
        scriptLabel: scriptLabelOf(script),
      };
    }),
  };
}
