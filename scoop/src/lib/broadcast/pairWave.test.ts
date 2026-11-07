import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Transaction } from "bitcoinjs-lib";
import {
  RDTS_EXPIRY_MS,
  RDTS_WARN_LEAD_MS,
  assemblePreview,
  assignFlavor,
  guessFlavor,
  maySendWave1,
  coreInputsSpent,
  filesForPhase,
  nextWave,
  sendStoppedReason,
  coinNeedFromStatus,
  pairWave,
  rdtsWarning,
  type SignedFile,
} from "./pairWave.ts";

function derSig(sighash: number): Buffer {
  const sig = Buffer.from("300602010102010101", "hex");
  sig[sig.length - 1] = sighash;
  return sig;
}

function pay(): Buffer {
  return Buffer.from("0014" + "11".repeat(20), "hex");
}

function longOp(): Buffer {
  const data = Buffer.alloc(85, 3);
  return Buffer.concat([Buffer.from([0x6a, 0x4c, data.length]), data]);
}

function shortOp(): Buffer {
  const data = Buffer.alloc(20, 4);
  return Buffer.concat([Buffer.from([0x6a, data.length]), data]);
}

function tx(sighashes: number[], outputs: Buffer[], inputs = 1): Transaction {
  const raw = new Transaction();
  for (let i = 0; i < inputs; i += 1) {
    raw.addInput(Buffer.alloc(32, i + 1), i);
    raw.setWitness(i, [derSig(sighashes[i] ?? sighashes[0])]);
  }
  for (const script of outputs) raw.addOutput(script, script[0] === 0x6a ? 0 : 50_000);
  return raw;
}

function file(partial: Partial<SignedFile> & Pick<SignedFile, "name" | "flavor" | "why">): SignedFile {
  return {
    inputCount: 1,
    outpoints: ["aa:0"],
    ...partial,
  };
}

describe("flavor classification", () => {
  it("marks a long OP_RETURN with SIGHASH_ALL as Core", () => {
    const guess = guessFlavor(tx([0x01], [pay(), longOp()]));
    assert.deepEqual(guess, { flavor: "core", why: "long-op-return" });
  });

  it("does not treat a short OP_RETURN as Core", () => {
    const guess = guessFlavor(tx([0x01], [pay(), shortOp()]));
    assert.deepEqual(guess, { flavor: "knots", why: "sighash-all" });
  });

  it("marks unified sighash as Knots even with a short OP_RETURN", () => {
    assert.deepEqual(guessFlavor(tx([0x21], [pay(), shortOp()])), {
      flavor: "knots",
      why: "unified-sighash",
    });
  });

  it("marks SIGHASH_ALL with no long OP_RETURN as Knots", () => {
    assert.deepEqual(guessFlavor(tx([0x01], [pay()])), { flavor: "knots", why: "sighash-all" });
  });

  it("refuses an unsigned transaction", () => {
    const raw = new Transaction();
    raw.addInput(Buffer.alloc(32, 1), 0);
    raw.addOutput(pay(), 1);
    assert.equal(guessFlavor(raw).flavor, null);
  });

  it("refuses unified sighash together with a long OP_RETURN", () => {
    const guess = guessFlavor(tx([0x21], [pay(), longOp()]));
    assert.equal(guess.flavor, null);
    assert.match(guess.why, /unified sighash and a long OP_RETURN/);
  });

  it("refuses mixed sighashes", () => {
    const raw = tx([0x21], [pay()]);
    raw.addInput(Buffer.alloc(32, 9), 1);
    raw.setWitness(1, [derSig(0x01)]);
    assert.equal(guessFlavor(raw).flavor, null);
  });

  it("relabels a SIGHASH_ALL file as Core only when every input is already Core-only", () => {
    const guess = guessFlavor(tx([0x01], [pay()]));
    assert.deepEqual(assignFlavor(guess, ["core-only"]), { flavor: "core", why: "knots-absent" });
    assert.deepEqual(assignFlavor(guess, ["needs-split"]), guess);
    assert.deepEqual(assignFlavor(guess, ["core-only", "needs-split"]), guess);
    assert.deepEqual(assignFlavor(guess, []), guess);
  });

  it("does not relabel a long OP_RETURN or a unified sighash from the catalog", () => {
    const core = guessFlavor(tx([0x01], [pay(), longOp()]));
    const knots = guessFlavor(tx([0x21], [pay()]));
    assert.equal(assignFlavor(core, ["core-only"]).why, "long-op-return");
    assert.equal(assignFlavor(knots, ["core-only"]).why, "unified-sighash");
  });
});

describe("pairing", () => {
  it("requires one Core file and one Knots file for a coin on both chains", () => {
    const ok = pairWave(
      [
        file({ name: "c.psbt", flavor: "core", why: "long-op-return" }),
        file({ name: "k.psbt", flavor: "knots", why: "sighash-all" }),
      ],
      { "aa:0": "needs-split" }
    );
    assert.equal(ok.ok, true);

    const missing = pairWave(
      [file({ name: "c.psbt", flavor: "core", why: "long-op-return" })],
      { "aa:0": "needs-split" }
    );
    assert.equal(missing.ok, false);

    const twoCore = pairWave(
      [
        file({ name: "c1.psbt", flavor: "core", why: "long-op-return" }),
        file({ name: "c2.psbt", flavor: "core", why: "long-op-return" }),
      ],
      { "aa:0": "needs-split" }
    );
    assert.equal(twoCore.ok, false);
  });

  it("allows one Core file when Knots already lacks the coin", () => {
    const ok = pairWave(
      [file({ name: "c.psbt", flavor: "core", why: "knots-absent", inputCount: 2, outpoints: ["aa:0", "bb:1"] })],
      { "aa:0": "core-only", "bb:1": "core-only" }
    );
    assert.equal(ok.ok, true);

    const extra = pairWave(
      [
        file({ name: "c.psbt", flavor: "core", why: "knots-absent" }),
        file({ name: "k.psbt", flavor: "knots", why: "sighash-all" }),
      ],
      { "aa:0": "core-only" }
    );
    assert.equal(extra.ok, false);
  });

  it("allows one Knots file when Core already lacks the coin", () => {
    const ok = pairWave(
      [file({ name: "k.psbt", flavor: "knots", why: "unified-sighash" })],
      { "aa:0": "knots-only" }
    );
    assert.equal(ok.ok, true);
  });

  it("fails closed on an unknown coin and does not call it a split", () => {
    const result = pairWave(
      [
        file({ name: "c.psbt", flavor: "core", why: "long-op-return" }),
        file({ name: "k.psbt", flavor: "knots", why: "sighash-all" }),
      ],
      {}
    );
    assert.equal(result.ok, false);
    assert.match(result.problems[0].message, /does not know this coin/);
  });

  it("rejects an unlabeled file even when the coin is known", () => {
    const result = pairWave(
      [file({ name: "bad.psbt", flavor: null, why: "This file has no signature." })],
      { "aa:0": "needs-split" }
    );
    assert.equal(result.ok, false);
    assert.match(result.problems[0].message, /no signature/);
  });

  it("does not invent a one-chain coin from a single tip", () => {
    assert.equal(coinNeedFromStatus("unspent", "spent"), "core-only");
    assert.equal(coinNeedFromStatus("spent", "unspent"), "knots-only");
    assert.equal(coinNeedFromStatus("unspent", "unspent"), "needs-split");
    assert.equal(coinNeedFromStatus("unspent", null), "unknown");
    assert.equal(coinNeedFromStatus("spent", "spent"), "unknown");
  });

  it("rejects a Knots file with two inputs", () => {
    const result = pairWave(
      [file({ name: "k.psbt", flavor: "knots", why: "sighash-all", inputCount: 2, outpoints: ["aa:0"] })],
      { "aa:0": "knots-only" }
    );
    assert.equal(result.ok, false);
  });
});

describe("preview assembly", () => {
  it("pairs a split and explains the Knots replay window", () => {
    const core = guessFlavor(tx([0x01], [pay(), longOp()]));
    const knots = guessFlavor(tx([0x01], [pay()]));
    const view = assemblePreview(
      [
        { name: "core.psbt", guess: core, inputCount: 1, outpoints: ["aa:0"] },
        { name: "knots.psbt", guess: knots, inputCount: 1, outpoints: ["aa:0"] },
      ],
      { "aa:0": "needs-split" }
    );
    assert.equal(view.pairOk, true);
    assert.equal(view.rows[0].flavor, "core");
    assert.match(view.rows[0].why, /Core file/);
    assert.match(view.rows[1].why, /replay onto Core/);
    assert.equal(view.rows[0].need, "needs-split");
  });

  it("relabels the Core file when the catalog says Knots is already gone", () => {
    const plain = guessFlavor(tx([0x01], [pay()]));
    const view = assemblePreview(
      [{ name: "core.psbt", guess: plain, inputCount: 1, outpoints: ["aa:0"] }],
      { "aa:0": "core-only" }
    );
    assert.equal(view.pairOk, true);
    assert.equal(view.rows[0].flavor, "core");
    assert.match(view.rows[0].why, /no long OP_RETURN/);
  });

  it("keeps an unknown coin closed even when the files look like a pair", () => {
    const core = guessFlavor(tx([0x01], [pay(), longOp()]));
    const knots = guessFlavor(tx([0x21], [pay()]));
    const view = assemblePreview(
      [
        { name: "core.psbt", guess: core, inputCount: 1, outpoints: ["zz:0"] },
        { name: "knots.psbt", guess: knots, inputCount: 1, outpoints: ["zz:0"] },
      ],
      {}
    );
    assert.equal(view.pairOk, false);
    assert.equal(view.rows[0].need, "unknown");
    assert.match(view.problems.map((problem) => problem.message).join(" "), /does not know this coin/);
  });

  it("does not hide an unlabeled file behind a known coin", () => {
    const view = assemblePreview(
      [{ name: "bad.psbt", guess: { flavor: null, why: "This file has no signature." }, inputCount: 1, outpoints: ["aa:0"] }],
      { "aa:0": "needs-split" }
    );
    assert.equal(view.pairOk, false);
    assert.equal(view.rows[0].flavor, null);
  });
});

describe("wave timing", () => {
  it("treats one unproven input as not spent, including during initial download", () => {
    assert.equal(coreInputsSpent([]), true);
    assert.equal(coreInputsSpent([true, true]), true);
    assert.equal(coreInputsSpent([true, false]), false);
    assert.equal(coreInputsSpent([true, null]), null);
    assert.equal(
      nextWave({ coreFileCount: 1, coreInputsSpent: coreInputsSpent([null]), knotsSent: false }).phase,
      "hold"
    );
  });

  it("holds Knots while a Core input is still unspent", () => {
    assert.equal(nextWave({ coreFileCount: 2, coreInputsSpent: false, knotsSent: false }).phase, "hold");
  });

  it("holds Knots when the node has not proved the spend", () => {
    const step = nextWave({ coreFileCount: 1, coreInputsSpent: null, knotsSent: false });
    assert.equal(step.phase, "hold");
    assert.match(step.reason, /not shown/);
  });

  it("sends Knots only after every Core input is spent in a block", () => {
    assert.equal(nextWave({ coreFileCount: 3, coreInputsSpent: true, knotsSent: false }).phase, "send-knots");
  });

  it("does not send Knots twice", () => {
    assert.equal(nextWave({ coreFileCount: 1, coreInputsSpent: true, knotsSent: true }).phase, "done");
  });

  it("sends a Knots-only wave immediately when there is no Core file", () => {
    assert.equal(nextWave({ coreFileCount: 0, coreInputsSpent: null, knotsSent: false }).phase, "send-knots");
  });

  it("sends only the files for the requested chain", () => {
    const files = [
      file({ name: "c.psbt", flavor: "core", why: "long-op-return" }),
      file({ name: "k.psbt", flavor: "knots", why: "sighash-all" }),
    ];
    assert.deepEqual(
      filesForPhase(files, "core").files.map((row) => row.name),
      ["c.psbt"]
    );
    assert.deepEqual(
      filesForPhase(files, "knots").files.map((row) => row.name),
      ["k.psbt"]
    );
    assert.equal(filesForPhase([files[1]], "core").ok, false);
  });

  it("does not claim nothing was sent after the first accept", () => {
    assert.equal(sendStoppedReason("core", 0), "Nothing sent.");
    assert.match(sendStoppedReason("core", 1), /cannot be taken back/);
    assert.match(sendStoppedReason("knots", 1), /already accepted/);
  });

  it("does not start wave 1 until every file is checked and the pair is clean", () => {
    assert.equal(maySendWave1({ fileCount: 2, checkedCount: 1, pairOk: true }).ok, false);
    assert.equal(maySendWave1({ fileCount: 2, checkedCount: 2, pairOk: false }).ok, false);
    assert.equal(maySendWave1({ fileCount: 2, checkedCount: 2, pairOk: true }).ok, true);
    assert.match(maySendWave1({ fileCount: 1, checkedCount: 0, pairOk: true }).reason, /cannot be taken back/);
  });
});

describe("RDTS warning", () => {
  const weekBefore = RDTS_EXPIRY_MS - RDTS_WARN_LEAD_MS;

  it("stays quiet more than a week before expiry", () => {
    assert.equal(rdtsWarning(weekBefore - 1, null).warn, false);
  });

  it("warns during the week before expiry and after it", () => {
    assert.equal(rdtsWarning(weekBefore, null).warn, true);
    assert.match(rdtsWarning(weekBefore, null).reasons[0], /within a week/);
    assert.match(rdtsWarning(RDTS_EXPIRY_MS, null).reasons[0], /expired/);
  });

  it("warns when the Knots tip median time has reached expiry even if the clock has not", () => {
    const early = RDTS_EXPIRY_MS - RDTS_WARN_LEAD_MS - 86_400_000;
    const warning = rdtsWarning(early, Math.floor(RDTS_EXPIRY_MS / 1000));
    assert.equal(warning.warn, true);
    assert.match(warning.reasons.join(" "), /median time/);
  });

  it("ignores a tip that is still before expiry", () => {
    const early = RDTS_EXPIRY_MS - RDTS_WARN_LEAD_MS - 86_400_000;
    assert.equal(rdtsWarning(early, Math.floor(RDTS_EXPIRY_MS / 1000) - 10).warn, false);
  });
});
