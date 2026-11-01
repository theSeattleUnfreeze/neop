import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveWatch, scripthashFromAddress } from "./address.ts";
import { expandAccountXpub } from "./xpub.ts";
import { materializeWallet, getFixture } from "../harness/throwawayWallets.ts";

describe("address → Electrum scripthash", () => {
  it("matches the abandon BIP84 receive address from xpub expand", () => {
    const wallet = materializeWallet(getFixture("native-segwit"), 1);
    const addr = wallet.scripts[0].address;
    const resolved = scripthashFromAddress(addr);
    assert.equal(addr, "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
    assert.equal(resolved.scripthash, wallet.scripts[0].scripthash);
    assert.equal(resolved.scriptPubKeyHex, wallet.scripts[0].scriptPubKeyHex);
  });

  it("resolveWatch accepts the address alone", () => {
    const z = expandAccountXpub({
      extendedKey: materializeWallet(getFixture("native-segwit"), 1).extendedKey,
      gapLimit: 1,
    });
    const r = resolveWatch({ address: z.scripts[0].address });
    assert.equal(r.scripthash, z.scripts[0].scripthash);
    assert.equal(r.address, z.scripts[0].address);
  });

  it("resolveWatch accepts a 64-hex scripthash", () => {
    const sh = "ab".repeat(32);
    const r = resolveWatch({ scripthash: sh });
    assert.equal(r.scripthash, sh);
  });

  it("rejects junk", () => {
    assert.throws(() => scripthashFromAddress("not-an-address"), /not a recognized/);
  });
});
