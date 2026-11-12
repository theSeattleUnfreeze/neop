import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandAccountXpub } from "./xpub.ts";
import { probeWatchUsage } from "./discoverXpub.ts";
import { getFixture, materializeWallet } from "../harness/throwawayWallets.ts";

describe("electrum preview when the node is down", () => {
  it("reports unreachable without walking every address", async () => {
    const key = materializeWallet(getFixture("native-segwit"), 1).extendedKey;
    const expanded = expandAccountXpub({ extendedKey: key, gapLimit: 8 });
    const started = Date.now();
    const usage = await probeWatchUsage(expanded.scripts, ["tcp://127.0.0.1:1"]);
    assert.equal(usage.reachable, false);
    assert.equal(usage.used, false);
    assert.ok(Date.now() - started < 3_000);
  });
});
