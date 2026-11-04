import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { openSparrowBytes, sealSparrowForTest, viewFromWalletJson, inspectSparrowWallet } from "./parseWallet.ts";

const ZPUB = `zpub${"1".repeat(80)}`;

describe("sparrow wallet file", () => {
  it("reads the account xpub and ignores a seed field", async () => {
    const raw = Buffer.from(
      JSON.stringify({
        name: "cold",
        policyType: "SINGLE",
        scriptType: "P2WPKH",
        keystores: [
          {
            label: "sparrow",
            extendedPublicKey: ZPUB,
            seed: { mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" },
            keyDerivation: { masterFingerprint: "00000000", derivationPath: "m/84'/0'/0'" },
          },
        ],
      })
    );
    const view = await inspectSparrowWallet(raw);
    assert.equal(view.name, "cold");
    assert.equal(view.accounts.length, 1);
    assert.equal(view.accounts[0].xpub, ZPUB);
    assert.equal(view.accounts[0].derivationPath, "m/84'/0'/0'");
    assert.equal(JSON.stringify(view).includes("abandon abandon"), false);
  });

  it("round-trips an encrypted SPRW1 payload with a supplied key", async () => {
    const priv = Buffer.alloc(32, 0x11);
    const ephemeral = Buffer.alloc(32, 0x22);
    const salt = Buffer.alloc(16, 0x33);
    const body = JSON.stringify({
      name: "sealed",
      policyType: "SINGLE",
      scriptType: "P2WPKH",
      keystores: [{ extendedPublicKey: ZPUB, keyDerivation: { derivationPath: "m/84'/0'/0'" } }],
    });
    const file = sealSparrowForTest(body, priv, ephemeral, salt);
    const opened = await openSparrowBytes(file, "ignored", async () => Buffer.from(priv));
    const view = viewFromWalletJson(opened);
    assert.equal((opened as { name: string }).name, "sealed");
    assert.equal(view.accounts[0].xpub, ZPUB);
    assert.notEqual(createHash("sha256").update(file).digest("hex"), createHash("sha256").update(body).digest("hex"));
  });

  it("rejects a Sparrow H2 database without reading it as JSON", async () => {
    await assert.rejects(
      inspectSparrowWallet(Buffer.from("H:2,block:1,blockSize:1000")),
      /mv\.db/
    );
  });

  it("asks for a password when the header is SPRW1", async () => {
    const priv = Buffer.alloc(32, 0x11);
    const file = sealSparrowForTest("{}", priv, Buffer.alloc(32, 0x44), Buffer.alloc(16, 1));
    await assert.rejects(() => inspectSparrowWallet(file), /password/i);
  });
});
