import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as bitcoin from "bitcoinjs-lib";
import { decodeTransaction, networkForAddress, scriptLabelOf } from "./decodeTx.ts";
import { discoverSpends, txidsToFetch } from "./discoverSpends.ts";

function p2wpkh(byte: number): { script: Buffer; address: string } {
  const hash = Buffer.alloc(20, byte);
  const payment = bitcoin.payments.p2wpkh({ hash, network: bitcoin.networks.bitcoin });
  if (!payment.output || !payment.address) throw new Error("p2wpkh");
  return { script: payment.output, address: payment.address };
}

describe("decodeTransaction", () => {
  it("reads two address outputs and one OP_RETURN", () => {
    const parent = Buffer.alloc(32, 0x11);
    const first = p2wpkh(0x22);
    const second = p2wpkh(0x33);
    const opReturn = bitcoin.script.compile([
      bitcoin.opcodes.OP_RETURN,
      Buffer.from("split"),
    ]);
    const tx = new bitcoin.Transaction();
    tx.addInput(parent, 1);
    tx.addOutput(first.script, 50_000);
    tx.addOutput(second.script, 40_000);
    tx.addOutput(opReturn, 0);

    const decoded = decodeTransaction(tx.toHex(), first.address);
    assert.equal(decoded.txid, tx.getId());
    assert.equal(decoded.inputs.length, 1);
    assert.equal(decoded.inputs[0].prevTxid, parent.toString("hex"));
    assert.equal(decoded.inputs[0].prevVout, 1);
    assert.equal(decoded.outputs.length, 3);
    assert.equal(decoded.outputs[0].address, first.address);
    assert.equal(decoded.outputs[0].scriptLabel, "p2wpkh");
    assert.equal(decoded.outputs[0].valueSats, 50_000);
    assert.equal(decoded.outputs[1].address, second.address);
    assert.equal(decoded.outputs[1].valueSats, 40_000);
    assert.equal(decoded.outputs[2].address, null);
    assert.equal(decoded.outputs[2].scriptLabel, "op_return");
    assert.equal(scriptLabelOf(opReturn), "op_return");
  });

  it("picks testnet from a tb1 hint", () => {
    assert.equal(networkForAddress("tb1qexample")?.bech32, "tb");
    assert.equal(networkForAddress("bc1qexample")?.bech32, "bc");
  });
});

describe("discoverSpends", () => {
  it("links a spend input to an earlier output that pays the script", () => {
    const mine = p2wpkh(0x44);
    const dest = p2wpkh(0x55);
    const change = p2wpkh(0x66);
    const funding = new bitcoin.Transaction();
    funding.addInput(Buffer.alloc(32, 0xaa), 0);
    funding.addOutput(mine.script, 100_000);
    const spend = new bitcoin.Transaction();
    spend.addInput(Buffer.from(funding.getId(), "hex").reverse(), 0);
    spend.addOutput(dest.script, 60_000);
    spend.addOutput(change.script, 39_000);
    spend.addOutput(bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from("x")]), 0);

    const found = discoverSpends({
      scriptPubKeyHex: mine.script.toString("hex"),
      address: mine.address,
      txs: [
        { ...decodeTransaction(funding.toHex(), mine.address), height: 10 },
        { ...decodeTransaction(spend.toHex(), mine.address), height: 11 },
      ],
    });
    assert.equal(found.length, 1);
    assert.equal(found[0].prevTxid, funding.getId());
    assert.equal(found[0].prevVout, 0);
    assert.equal(found[0].spendTxid, spend.getId());
    assert.equal(found[0].valueSats, 100_000);
    assert.equal(found[0].outputs.length, 3);
    assert.equal(found[0].outputs[2].scriptLabel, "op_return");
  });

  it("skips Electrum fetches when recorded spends already cover the history window", () => {
    const funding = "aa".repeat(32);
    const spend = "bb".repeat(32);
    const history = [
      { tx_hash: funding, height: 1 },
      { tx_hash: spend, height: 2 },
    ];
    const unspent = [{ tx_hash: funding, tx_pos: 0, value: 1, height: 1 }];
    assert.deepEqual(
      txidsToFetch({
        history,
        unspent,
        knownSpendTxids: new Set([spend]),
        unresolvedSpent: 0,
      }),
      []
    );
    assert.deepEqual(
      txidsToFetch({
        history,
        unspent,
        knownSpendTxids: new Set(),
        unresolvedSpent: 0,
      }),
      [spend, funding]
    );
    assert.deepEqual(
      txidsToFetch({
        history,
        unspent: [],
        knownSpendTxids: new Set([spend]),
        knownPrevTxids: new Set([funding]),
        unresolvedSpent: 0,
      }),
      []
    );
  });
});
