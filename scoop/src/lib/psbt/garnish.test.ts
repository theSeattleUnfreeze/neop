import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Psbt } from "bitcoinjs-lib";
import {
  MAX_PAYLOAD_LEN,
  MAX_WEDGE_SCRIPT_LEN,
  MIN_PAYLOAD_LEN,
  MIN_WEDGE_SCRIPT_LEN,
  garnishUnsignedPsbt,
  nextWedge,
  opReturnScript,
  type Wedge,
} from "./garnish.ts";

function oneCoinPsbt(payValue = 90_000): Psbt {
  const psbt = new Psbt();
  psbt.addInput({
    hash: Buffer.alloc(32, 0x11),
    index: 0,
    witnessUtxo: {
      script: Buffer.from("0014" + "11".repeat(20), "hex"),
      value: 100_000,
    },
  });
  psbt.addOutput({
    script: Buffer.from("0014" + "22".repeat(20), "hex"),
    value: payValue,
  });
  return psbt;
}

function pushes(script: Buffer): Buffer[] {
  if (script[0] !== 0x6a) throw new Error("not an OP_RETURN");
  const out: Buffer[] = [];
  let i = 1;
  while (i < script.length) {
    const op = script[i];
    if (op >= 1 && op <= 75) {
      out.push(script.subarray(i + 1, i + 1 + op));
      i += 1 + op;
    } else if (op === 0x4c) {
      const n = script[i + 1];
      out.push(script.subarray(i + 2, i + 2 + n));
      i += 2 + n;
    } else {
      throw new Error("unexpected opcode");
    }
  }
  return out;
}

const stub = (): Wedge => ({
  script: opReturnScript(Buffer.alloc(85, 1)),
  kind: "bytes",
  dataBytes: 85,
});

describe("garnish", () => {
  it("adds a unique OP_RETURN longer than 83 bytes and raises the fee", () => {
    const raw = oneCoinPsbt().toBuffer();
    const first = garnishUnsignedPsbt(raw, nextWedge(0));
    const second = garnishUnsignedPsbt(raw, nextWedge(1));
    assert.ok(first.scriptPubKeyLength >= MIN_WEDGE_SCRIPT_LEN);
    assert.ok(first.scriptPubKeyLength <= MAX_WEDGE_SCRIPT_LEN);
    assert.ok(first.feeSatsAfter > first.feeSatsBefore);
    assert.equal(first.inputCount, 1);
    assert.notEqual(first.psbtBase64, second.psbtBase64);

    const again = Psbt.fromBase64(first.psbtBase64);
    assert.equal(again.inputCount, 1);
    assert.equal(again.txOutputs.length, 2);
    const wedge = again.txOutputs.find((out) => out.script[0] === 0x6a);
    assert.ok(wedge);
    assert.ok(wedge!.script.length >= MIN_WEDGE_SCRIPT_LEN && wedge!.script.length <= MAX_WEDGE_SCRIPT_LEN);
    assert.equal(wedge!.value, 0);
    assert.equal(again.txOutputs[0].value, 90_000 - (first.feeSatsAfter - first.feeSatsBefore));
  });

  it("refuses a signed PSBT", () => {
    const psbt = oneCoinPsbt();
    const signature = Buffer.from("300602010102010101", "hex");
    psbt.updateInput(0, {
      partialSig: [{ pubkey: Buffer.alloc(33, 3), signature }],
    });
    assert.throws(() => garnishUnsignedPsbt(psbt.toBuffer(), stub()), /already signed/);
  });

  it("refuses to join inputs", () => {
    const psbt = oneCoinPsbt();
    psbt.addInput({
      hash: Buffer.alloc(32, 0x22),
      index: 1,
      witnessUtxo: {
        script: Buffer.from("0014" + "33".repeat(20), "hex"),
        value: 50_000,
      },
    });
    assert.throws(() => garnishUnsignedPsbt(psbt.toBuffer(), stub()), /one coin at a time/);
  });

  it("cycles payload shape and keeps the script within 84 through 120 bytes", () => {
    const kinds = ["bytes", "text", "hex", "pushes"] as const;
    const lengths = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const wedge = nextWedge(i);
      assert.equal(wedge.kind, kinds[i % 4]);
      assert.ok(wedge.script.length >= MIN_WEDGE_SCRIPT_LEN && wedge.script.length <= MAX_WEDGE_SCRIPT_LEN);
      assert.ok(wedge.dataBytes >= MIN_PAYLOAD_LEN - 1 && wedge.dataBytes <= MAX_PAYLOAD_LEN);
      lengths.add(wedge.dataBytes);
      const parts = pushes(wedge.script);
      const data = Buffer.concat(parts);
      assert.equal(data.length, wedge.dataBytes);
      if (wedge.kind === "bytes") {
        assert.equal(parts.length, 1);
        assert.ok([...data].some((b) => b < 0x20 || b > 0x7e));
      } else if (wedge.kind === "text") {
        assert.equal(parts.length, 1);
        assert.match(data.toString("ascii"), /^[a-zA-Z0-9 .,;:-]+$/);
      } else if (wedge.kind === "hex") {
        assert.equal(parts.length, 1);
        assert.match(data.toString("ascii"), /^[0-9a-f]+$/);
        assert.equal(data.length % 2, 0);
      } else {
        assert.ok(parts.length === 2 || parts.length === 3);
        assert.match(parts[0].toString("ascii"), /^[a-zA-Z0-9 .,;:-]+$/);
      }
    }
    assert.ok(lengths.size > 1);
  });
});
