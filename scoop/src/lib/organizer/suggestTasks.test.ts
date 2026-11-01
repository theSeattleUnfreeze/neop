import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { annotate } from "../catalog/presence.ts";
import { suggestTasksFromRows } from "./suggestTasks.ts";

describe("suggestTasks", () => {
  it("suggests replay receive for matching dual unspent outpoint", () => {
    const row = {
      ...annotate({
        scriptId: 3,
        address: "bc1qxyz",
        core: {
          status: "unspent",
          txid: "aa".repeat(32),
          vout: 0,
          valueSats: 10n,
        },
        knots: {
          status: "unspent",
          txid: "aa".repeat(32),
          vout: 0,
          valueSats: 10n,
        },
      }),
    };
    const tasks = suggestTasksFromRows([row]);
    assert.ok(tasks.some((t) => t.kind === "auto_replay_receive"));
    assert.ok(!tasks.some((t) => t.kind === "auto_both"));
  });

  it("suggests spill and core-bound tasks", () => {
    const spill = {
      ...annotate({
        scriptId: 1,
        address: null,
        core: { status: "spent", spendTxid: "11".repeat(32) },
        knots: { status: "spent", spendTxid: "22".repeat(32) },
      }),
    };
    const bound = {
      ...annotate({
        scriptId: 2,
        address: "bc1q",
        core: { status: "spent", spendTxid: "33".repeat(32) },
        knots: { status: "unspent", valueSats: 1n, txid: "44".repeat(32), vout: 0 },
      }),
    };
    const tasks = suggestTasksFromRows([spill, bound]);
    assert.ok(tasks.some((t) => t.kind === "auto_spill"));
    assert.ok(tasks.some((t) => t.kind === "auto_core_bound"));
  });

  it("dedupes keys stably per script", () => {
    const row = {
      ...annotate({
        scriptId: 9,
        address: "x",
        core: { status: "unspent", valueSats: 1n, txid: "a", vout: 0 },
        knots: { status: "unspent", valueSats: 1n, txid: "b", vout: 1 },
      }),
    };
    const a = suggestTasksFromRows([row]);
    const b = suggestTasksFromRows([row]);
    assert.equal(a[0].dedupeKey, b[0].dedupeKey);
  });
});
