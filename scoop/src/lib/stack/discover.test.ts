import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  applyDiscoveredPaths,
  argValue,
  corePathsFromProcess,
  fulcrumPathsFromMounts,
} from "./discover.ts";
import { emptyService, type StackConfig } from "./types.ts";

function config(): StackConfig {
  const core = emptyService("core-node", "Core node", "local");
  core.endpoint = "http://127.0.0.1:8332";
  const fulcrum = emptyService("core-fulcrum", "Core Fulcrum", "local");
  fulcrum.containerName = "fulcrum-core-forward";
  return { services: [core, fulcrum], explorers: { core: "", knots: "" } };
}

describe("stack path discovery", () => {
  it("reads datadir, conf, and cookie from a bitcoind command line", () => {
    const found = corePathsFromProcess({
      executable: "C:\\Bitcoin\\bitcoind.exe",
      commandLine: '"C:\\Bitcoin\\bitcoind.exe" -datadir=E:\\Bitcoin',
    });
    assert.equal(argValue(found.binary ? "-datadir=E:\\Bitcoin" : "", "datadir"), "E:\\Bitcoin");
    assert.equal(found.datadir, "E:\\Bitcoin");
    assert.equal(found.configFile, path.join("E:\\Bitcoin", "bitcoin.conf"));
    assert.equal(found.cookieFile, path.join("E:\\Bitcoin", ".cookie"));
  });

  it("reads Fulcrum mounts and does not replace a path the operator already set", () => {
    const mounts = fulcrumPathsFromMounts([
      { Source: "E:\\index", Destination: "/data" },
      { Source: "D:\\electrum\\fulcrum-forward.conf", Destination: "/forward.conf" },
      { Source: "E:\\Bitcoin\\.cookie", Destination: "/run/secrets/cookie" },
    ]);
    const current = config();
    current.services[0].datadir = "D:\\kept";
    const filled = applyDiscoveredPaths(
      current,
      {
        core: corePathsFromProcess({
          executable: "C:\\Bitcoin\\bitcoind.exe",
          commandLine: "bitcoind -datadir=E:\\Bitcoin -conf=E:\\Bitcoin\\bitcoin.conf",
        }),
        fulcrum: mounts,
      },
      () => true
    );
    const core = filled.services.find((svc) => svc.id === "core-node");
    const fulcrum = filled.services.find((svc) => svc.id === "core-fulcrum");
    assert.equal(core?.datadir, "D:\\kept");
    assert.equal(core?.configFile, "E:\\Bitcoin\\bitcoin.conf");
    assert.equal(fulcrum?.datadir, "E:\\index");
    assert.equal(fulcrum?.configFile, "D:\\electrum\\fulcrum-forward.conf");
    assert.equal(fulcrum?.cookieFile, "E:\\Bitcoin\\.cookie");
  });

  it("uses the default datadir and the chain cookie, not a leftover mainnet cookie", () => {
    const found = corePathsFromProcess(
      { executable: "bitcoind", commandLine: "bitcoind -testnet4" },
      { platform: "linux", env: { HOME: "/home/op" } }
    );
    assert.equal(found.datadir, "/home/op/.bitcoin");
    assert.equal(found.configFile, "/home/op/.bitcoin/bitcoin.conf");
    assert.equal(found.cookieFile, "/home/op/.bitcoin/testnet4/.cookie");
  });

  it("does not copy a Core cookie that is not on disk", () => {
    const current = config();
    const filled = applyDiscoveredPaths(
      current,
      {
        core: {
          binary: "",
          datadir: "E:\\Bitcoin",
          configFile: "",
          cookieFile: "E:\\Bitcoin\\.cookie",
        },
      },
      (candidate) => candidate !== "E:\\Bitcoin\\.cookie"
    );
    const fulcrum = filled.services.find((svc) => svc.id === "core-fulcrum");
    assert.equal(fulcrum?.cookieFile, "");
  });
});
