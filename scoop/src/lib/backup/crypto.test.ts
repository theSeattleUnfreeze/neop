import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decryptBackup, encryptBackup, parseEnvelope } from "./crypto.ts";
import { jsonRevive, jsonSafe, parseSnapshot } from "./snapshot.ts";

describe("backup encryption", () => {
  it("round-trips plaintext and leaves the sentinel out of the file", async () => {
    const secret = "watch-key-sentinel-xpub";
    const envelope = await encryptBackup(secret, "correct horse battery", { n: 16384, r: 8, p: 1 });
    const file = JSON.stringify(envelope);
    assert.equal(file.includes(secret), false);
    assert.equal(file.includes("correct horse"), false);
    const opened = await decryptBackup(parseEnvelope(file), "correct horse battery");
    assert.equal(opened, secret);
  });

  it("rejects a wrong password", async () => {
    const envelope = await encryptBackup("catalog", "long-password", { n: 16384, r: 8, p: 1 });
    await assert.rejects(
      () => decryptBackup(envelope, "other-password"),
      /Check the password/
    );
  });
});

describe("snapshot json", () => {
  it("preserves sats and timestamps", () => {
    const at = new Date("2026-01-02T03:04:05.000Z");
    const revived = jsonRevive(jsonSafe({ valueSats: 10n, at, label: "ok" })) as {
      valueSats: bigint;
      at: Date;
      label: string;
    };
    assert.equal(revived.valueSats, 10n);
    assert.equal(revived.at.toISOString(), at.toISOString());
    assert.equal(revived.label, "ok");
  });

  it("rejects a snapshot that is not version 1", () => {
    assert.throws(() => parseSnapshot({ version: 2, exportedAt: "t", tables: {} }), /unrecognized/);
  });
});
