import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rowChunks } from "./store.ts";

describe("backup insert chunks", () => {
  it("splits a table so one insert stays under the bind cap", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i, a: 1, b: 2 }));
    const chunks = rowChunks(rows, 6);
    assert.equal(chunks.length, 3);
    assert.deepEqual(chunks.map((chunk) => chunk.length), [2, 2, 1]);
  });

  it("keeps a small table in one insert", () => {
    const rows = [{ id: 1, name: "wallet" }];
    assert.equal(rowChunks(rows).length, 1);
  });
});
