import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startBlockReason } from "./control.ts";
import { diagnoseStack } from "./diagnose.ts";
import { emptyService } from "./types.ts";

describe("stack control", () => {
  it("does not start a remote Knots service", () => {
    const knots = emptyService("knots-fulcrum", "Knots Fulcrum", "remote");
    knots.endpoint = "ssl://knots.example:50002";
    knots.remoteStart = "ssh startos@STARTOS_HOST echo up";
    assert.match(startBlockReason(knots) ?? "", /observed/);
  });

  it("requires a binary before starting Core", () => {
    const core = emptyService("core-node", "Core node", "local");
    assert.match(startBlockReason(core) ?? "", /binary/);
    core.binary = "C:\\Bitcoin\\bitcoind.exe";
    core.datadir = "C:\\Bitcoin\\data";
    assert.equal(startBlockReason(core), null);
  });

  it("allows loopback or all-interfaces Core Fulcrum publish", () => {
    const fulcrum = emptyService("core-fulcrum", "Core Fulcrum", "local");
    fulcrum.containerName = "fulcrum";
    fulcrum.image = "fulcrum";
    fulcrum.datadir = "C:\\fulcrum";
    fulcrum.configFile = "C:\\fulcrum\\fulcrum.conf";
    fulcrum.publish = "evil.example:50111:50111";
    assert.match(startBlockReason(fulcrum) ?? "", /local bind/);
    fulcrum.publish = "0.0.0.0:50111:50111";
    assert.equal(startBlockReason(fulcrum), null);
    fulcrum.publish = "127.0.0.1:50111:50111";
    assert.equal(startBlockReason(fulcrum), null);
    fulcrum.publish = "50111:50111";
    assert.equal(startBlockReason(fulcrum), null);
  });
});

describe("stack diagnose", () => {
  it("diagnoses Core without inventing a Start when paths are empty", async () => {
    const core = emptyService("core-node", "Core node", "local");
    const [row] = await diagnoseStack([core]);
    assert.equal(row.id, "core-node");
    assert.equal(row.canStart, false);
    assert.ok(row.steps.length > 0);
    assert.ok(row.steps.some((step) => /bitcoind|Core|cookie|RPC/i.test(step.title + step.body)));
  });
});
