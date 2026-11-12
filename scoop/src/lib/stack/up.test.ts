import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyService } from "./types.ts";
import { bringUpStack, planStackUp } from "./up.ts";

describe("planStackUp", () => {
  it("starts a configured Core node whose port is closed", () => {
    const core = emptyService("core-node", "Core", "local");
    core.binary = "C:\\Bitcoin\\bitcoind.exe";
    core.datadir = "C:\\Bitcoin\\data";
    core.endpoint = "http://127.0.0.1:8332";
    assert.equal(planStackUp(core, false).kind, "local");
    assert.equal(planStackUp(core, true).kind, "already-up");
  });

  it("runs a remote start command and ignores it on the local Core service", () => {
    const knots = emptyService("knots-node", "Knots", "remote");
    knots.endpoint = "http://STARTOS_HOST:57747";
    assert.equal(planStackUp(knots, false).kind, "skip");
    knots.remoteStart = "ssh -i IDENTITY startos@STARTOS_HOST echo up";
    assert.equal(planStackUp(knots, false).kind, "remote");
    assert.equal(planStackUp(knots, true).kind, "already-up");
    assert.equal(planStackUp(knots, null).kind, "skip");
    const core = emptyService("core-node", "Core", "local");
    core.binary = "bitcoind";
    core.datadir = "data";
    core.remoteStart = "ssh startos@STARTOS_HOST echo up";
    assert.equal(planStackUp(core, false).kind, "local");
  });

  it("skips the tunnel until its script and host are set", () => {
    const link = emptyService("knots-link", "Knots tunnel", "local");
    assert.equal(planStackUp(link, false).kind, "skip");
  });
});

describe("bringUpStack", () => {
  it("starts local Core, runs the Knots command, and records a failure", async () => {
    const core = emptyService("core-node", "Core", "local");
    core.binary = "bitcoind";
    core.datadir = "data";
    core.endpoint = "http://127.0.0.1:8332";
    const knots = emptyService("knots-node", "Knots", "remote");
    knots.endpoint = "http://STARTOS_HOST:57747";
    knots.remoteStart = "ssh startos@STARTOS_HOST echo up";
    const fulcrum = emptyService("knots-fulcrum", "Knots Fulcrum", "remote");
    fulcrum.endpoint = "ssl://STARTOS_HOST:50002";
    const started: string[] = [];
    const result = await bringUpStack(
      { services: [core, knots, fulcrum], explorers: { core: "", knots: "" } },
      {
        portOpen: async () => false,
        startLocal: async (svc) => {
          started.push(svc.id);
          return "started";
        },
        startRemote: async (svc) => {
          if (svc.id === "knots-node") throw new Error("ssh failed");
          return "ok";
        },
      }
    );
    assert.deepEqual(started, ["core-node"]);
    assert.equal(result.failed, true);
    assert.match(result.lines.join("\n"), /Core: started/);
    assert.match(result.lines.join("\n"), /Knots: ssh failed/);
    assert.match(result.lines.join("\n"), /Knots Fulcrum: left alone/);
    assert.equal(result.lines.join("\n").includes("ssh startos"), false);
  });
});
