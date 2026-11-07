import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Psbt } from "bitcoinjs-lib";
import { inspectPsbt } from "./inspectPsbt.ts";

function oneCoin(): Psbt {
  const psbt = new Psbt();
  psbt.addInput({
    hash: Buffer.alloc(32, 0x11),
    index: 0,
    witnessUtxo: {
      script: Buffer.from("0014" + "ab".repeat(20), "hex"),
      value: 100_000,
    },
  });
  psbt.addOutput({
    script: Buffer.from("0014" + "cd".repeat(20), "hex"),
    value: 90_000,
  });
  return psbt;
}

describe("inspect PSBT", () => {
  it("reads the input outpoint and address and leaves an unsigned file unlabeled", () => {
    const seen = inspectPsbt("coin.psbt", oneCoin().toBuffer());
    assert.equal(seen.guess.flavor, null);
    assert.match(seen.guess.why, /no signature/);
    assert.equal(seen.inputCount, 1);
    assert.equal(seen.outpoints.length, 1);
    assert.match(seen.outpoints[0], /:0$/);
    assert.equal(seen.addresses.length, 1);
    assert.match(seen.addresses[0], /^bc1/);
    assert.equal(seen.hex, null);
    assert.equal(seen.txid, null);
  });

  it("does not relabel an unsigned file just because the catalog says Core-only", () => {
    const seen = inspectPsbt("coin.psbt", oneCoin().toBuffer(), ["core-only"]);
    assert.equal(seen.guess.flavor, null);
  });
});
