import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  annotate,
  filterByFlavor,
  isCoreBoundSuccess,
  isSpill,
  presenceOf,
  type CoinRow,
  type TipView,
} from "./presence.ts";
import { coinRowFromTips, detectSpills } from "../sync/buildRows.ts";
import { electrumScripthashFromScriptPubKey, normalizeScripthash } from "../electrum/scripthash.ts";
import { parseElectrumUrl } from "../electrum/client.ts";

const unspent = (txid = "aa".repeat(32)): TipView => ({
  status: "unspent",
  txid,
  vout: 0,
  valueSats: 1000,
});
const spent = (opts?: { spendTxid?: string; txid?: string; vout?: number }): TipView => ({
  status: "spent",
  spendTxid: opts?.spendTxid ?? "bb".repeat(32),
  txid: opts?.txid ?? "aa".repeat(32),
  vout: opts?.vout ?? 0,
});
const absent: TipView = { status: "absent" };

describe("presence", () => {
  it("labels core_only / knots_only / both", () => {
    assert.equal(presenceOf(unspent(), absent), "core_only");
    assert.equal(presenceOf(absent, unspent()), "knots_only");
    assert.equal(presenceOf(unspent(), unspent()), "both");
    assert.equal(presenceOf(absent, absent), "none");
  });

  it("detects core-bound success without spill", () => {
    const core = spent();
    const knots = unspent();
    assert.equal(isCoreBoundSuccess(core, knots), true);
    assert.equal(isSpill(core, knots), false);
  });

  it("detects spill when both tips spent on the same outpoint", () => {
    assert.equal(
      isSpill(
        spent({ spendTxid: "11".repeat(32), txid: "aa".repeat(32), vout: 0 }),
        spent({ spendTxid: "22".repeat(32), txid: "aa".repeat(32), vout: 0 })
      ),
      true
    );
  });

  it("returns false when both spent with different outpoints", () => {
    assert.equal(
      isSpill(
        { status: "spent", txid: "aa", vout: 0 },
        { status: "spent", txid: "bb", vout: 1 }
      ),
      false
    );
  });

  it("flags incomplete outpoint metadata for manual review", () => {
    assert.equal(isSpill({ status: "spent", txid: "aa" }, { status: "spent" }), true);
    assert.equal(isSpill({ status: "spent" }, { status: "spent", txid: "bb", vout: 0 }), true);
  });

  it("filters flavor views", () => {
    const row = annotate({
      scriptId: 1,
      address: "bc1q",
      core: unspent(),
      knots: absent,
    });
    assert.equal(filterByFlavor(row, "core"), true);
    assert.equal(filterByFlavor(row, "knots"), false);
  });
});

describe("annotate", () => {
  it("adds presence, coreBoundOk, and spill fields", () => {
    const row: CoinRow = {
      scriptId: 42,
      core: { status: "spent", txid: "x", vout: 0 },
      knots: { status: "unspent" },
    };
    const out = annotate(row);
    assert.equal(out.scriptId, 42);
    assert.equal(out.presence, "both");
    assert.equal(out.coreBoundOk, true);
    assert.equal(out.spill, false);
  });
});

describe("buildRows", () => {
  it("maps electrum snapshots into annotated rows", () => {
    const row = coinRowFromTips(
      7,
      "bc1qtest",
      {
        tip: "core",
        scripthash: "00".repeat(32),
        ok: true,
        unspent: [],
        history: [{ tx_hash: "cc".repeat(32), height: 100 }],
      },
      {
        tip: "knots",
        scripthash: "00".repeat(32),
        ok: true,
        unspent: [{ tx_hash: "dd".repeat(32), tx_pos: 1, value: 50, height: 100 }],
        history: [{ tx_hash: "dd".repeat(32), height: 100 }],
      }
    );
    assert.equal(row.presence, "both");
    assert.equal(row.coreBoundOk, true);
    assert.equal(row.spill, false);
    assert.equal(detectSpills([row]).length, 0);
  });

  it("flags spills when both spent without outpoint metadata", () => {
    const row = coinRowFromTips(
      1,
      null,
      {
        tip: "core",
        scripthash: "00".repeat(32),
        ok: true,
        unspent: [],
        history: [{ tx_hash: "ee".repeat(32), height: 1 }],
      },
      {
        tip: "knots",
        scripthash: "00".repeat(32),
        ok: true,
        unspent: [],
        history: [{ tx_hash: "ff".repeat(32), height: 1 }],
      }
    );
    assert.equal(row.spill, true);
    assert.equal(detectSpills([row]).length, 1);
  });

  it("serializes unspent rows for JSON API responses", () => {
    const row = coinRowFromTips(
      1,
      "bc1q",
      {
        tip: "core",
        scripthash: "00".repeat(32),
        ok: true,
        unspent: [{ tx_hash: "aa".repeat(32), tx_pos: 0, value: 12345, height: 1 }],
        history: [],
      },
      undefined
    );
    assert.doesNotThrow(() => JSON.stringify(row));
    assert.equal(row.core.valueSats, 12345);
  });
});

describe("electrum helpers", () => {
  it("parses urls", () => {
    assert.deepEqual(parseElectrumUrl("tcp://127.0.0.1:15001"), {
      host: "127.0.0.1",
      port: 15001,
      tls: false,
    });
    assert.equal(parseElectrumUrl("ssl://node.local:50002").tls, true);
  });

  it("normalizes scripthash", () => {
    const h = "ab".repeat(32);
    assert.equal(normalizeScripthash(h), h);
    assert.throws(() => normalizeScripthash("zz"));
  });

  it("hashes scriptPubKey to electrum scripthash", () => {
    const spk = Buffer.from("0014" + "11".repeat(20), "hex");
    const sh = electrumScripthashFromScriptPubKey(spk);
    assert.match(sh, /^[0-9a-f]{64}$/);
  });
});
