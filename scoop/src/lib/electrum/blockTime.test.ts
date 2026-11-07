import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blockTimeFromHeaderHex, createBlockTimeResolver } from "./blockTime.ts";

describe("blockTime", () => {
  it("reads the timestamp from an 80-byte header", () => {
    const header = Buffer.alloc(80, 0);
    header.writeUInt32LE(1_700_000_000, 68);
    const at = blockTimeFromHeaderHex(header.toString("hex"));
    assert.ok(at);
    assert.equal(at!.toISOString(), new Date(1_700_000_000 * 1000).toISOString());
  });

  it("rejects junk and pre-genesis times", () => {
    assert.equal(blockTimeFromHeaderHex("abcd"), null);
    const header = Buffer.alloc(80, 0);
    header.writeUInt32LE(1, 68);
    assert.equal(blockTimeFromHeaderHex(header.toString("hex")), null);
  });

  it("caches header lookups by height", async () => {
    let calls = 0;
    const resolver = createBlockTimeResolver(async (height) => {
      calls += 1;
      const header = Buffer.alloc(80, 0);
      header.writeUInt32LE(1_600_000_000 + height, 68);
      return header.toString("hex");
    });
    const first = await resolver.timeForHeight(800_000);
    const second = await resolver.timeForHeight(800_000);
    assert.equal(calls, 1);
    assert.equal(first?.getTime(), second?.getTime());
    assert.equal(await resolver.timeForHeight(0), null);
  });
});
