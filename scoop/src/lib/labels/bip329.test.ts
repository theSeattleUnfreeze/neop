import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acceptLabelRecords, noteForOutpoint, parseBip329 } from "./bip329.ts";

const TX = "aa".repeat(32);

describe("BIP-329 labels", () => {
  it("imports nothing from an empty file", () => {
    const parsed = parseBip329("");
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.records, []);
    assert.equal(parsed.suggestedName, null);
  });

  it("uses an output label, then the transaction label", () => {
    const parsed = parseBip329(
      [
        JSON.stringify({ type: "tx", ref: TX, label: "from the exchange" }),
        JSON.stringify({ type: "output", ref: `${TX}:0`, label: "the coin" }),
        JSON.stringify({ type: "addr", ref: "bc1qexample", label: "receive" }),
      ].join("\n")
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(noteForOutpoint(parsed.records, TX, 0), "the coin");
    assert.equal(noteForOutpoint(parsed.records, TX, 1), "from the exchange");
  });

  it("suggests a wallet name from an xpub line and does not keep the key", () => {
    const parsed = parseBip329(
      JSON.stringify({ type: "xpub", ref: "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8Nq", label: "Coldcard" })
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.suggestedName, "Coldcard");
    assert.deepEqual(parsed.records, []);
    assert.equal(JSON.stringify(parsed).includes("xpub661"), false);
  });

  it("rejects a broken line and refuses to store an extended key", () => {
    const broken = parseBip329("{");
    assert.equal(broken.ok, false);
    const refused = acceptLabelRecords([{ type: "addr", ref: "xpub661MyMw", label: "nope" }]);
    assert.equal(refused.ok, false);
  });
});
