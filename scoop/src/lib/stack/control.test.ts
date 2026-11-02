import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startBlockReason } from "./control.ts";
import { emptyService } from "./types.ts";

describe("stack control", () => {
  it("does not start a remote Knots service", () => {
    const knots = emptyService("knots-fulcrum", "Knots Fulcrum", "remote");
    knots.endpoint = "ssl://knots.example:50002";
    assert.match(startBlockReason(knots) ?? "", /observed/);
  });

  it("requires a binary before starting Core", () => {
    const core = emptyService("core-node", "Core node", "local");
    assert.match(startBlockReason(core) ?? "", /binary/);
    core.binary = "C:\\Bitcoin\\bitcoind.exe";
    core.datadir = "E:\\Bitcoin";
    assert.equal(startBlockReason(core), null);
  });
});
