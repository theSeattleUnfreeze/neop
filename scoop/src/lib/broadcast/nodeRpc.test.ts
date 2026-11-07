import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scrubRpcText } from "./nodeRpc.ts";

describe("RPC errors", () => {
  it("strips long hex before an error is shown", () => {
    const hex = "ab".repeat(40);
    const text = scrubRpcText(`rejected ${hex} for a fee`);
    assert.equal(text.includes(hex), false);
    assert.match(text, /rejected/);
  });
});
