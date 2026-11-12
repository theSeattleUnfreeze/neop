import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  loadStackConfig,
  localizeStackEndpoint,
  normalizeStackConfig,
  revealablePaths,
  saveStackConfig,
} from "./config.ts";
import { rpcProbeFromHttp, selectRpcAttempt } from "./probe.ts";
import { summarizeStack } from "./summarize.ts";
import type { StackStatusRow } from "./types.ts";

function row(partial: Partial<StackStatusRow> & Pick<StackStatusRow, "id" | "state">): StackStatusRow {
  return {
    label: partial.id,
    control: "local",
    endpoint: "",
    height: null,
    headers: null,
    progress: null,
    detail: "",
    configFile: "",
    datadir: "",
    files: [],
    ...partial,
  };
}

describe("stack summary", () => {
  it("does not treat Core vs Knots tip gap as a problem", () => {
    const forked = summarizeStack([
      row({ id: "core-node", state: "up", height: 100, label: "Core node" }),
      row({ id: "core-fulcrum", state: "up", height: 100, label: "Core Fulcrum" }),
      row({ id: "knots-node", state: "up", height: 900, label: "Knots node" }),
      row({ id: "knots-fulcrum", state: "up", height: 900, label: "Knots Fulcrum" }),
    ]);
    assert.equal(forked.catalogReady, true);
    assert.match(forked.summary, /own chains/i);
  });

  it("warns when an indexer lags its own node", () => {
    const lagged = summarizeStack([
      row({ id: "core-node", state: "up", height: 200, label: "Core node" }),
      row({ id: "core-fulcrum", state: "up", height: 100, label: "Core Fulcrum" }),
      row({ id: "knots-fulcrum", state: "up", height: 900, label: "Knots Fulcrum" }),
    ]);
    assert.equal(lagged.catalogReady, false);
    assert.match(lagged.summary, /Core Fulcrum/);
    assert.match(lagged.summary, /100/);
  });

  it("names the indexer that is down", () => {
    const summary = summarizeStack([
      row({ id: "core-fulcrum", state: "down", label: "Core Fulcrum" }),
      row({ id: "knots-fulcrum", state: "up", height: 10, label: "Knots Fulcrum" }),
    ]);
    assert.equal(summary.catalogReady, false);
    assert.match(summary.summary, /Core Fulcrum/);
  });
});

describe("rpc probe", () => {
  it("treats 401 as up without a height", () => {
    const row = rpcProbeFromHttp(401, null);
    assert.equal(row.state, "up");
    assert.equal(row.height, null);
    assert.equal(row.progress, null);
    assert.match(row.detail, /credentials/);
  });

  it("keeps block height and verification progress while the node syncs", () => {
    const row = rpcProbeFromHttp(200, {
      result: { blocks: 100, headers: 400, initialblockdownload: true, verificationprogress: 0.25 },
    });
    assert.equal(row.height, 100);
    assert.equal(row.headers, 400);
    assert.equal(row.progress, 0.25);
    assert.match(row.detail, /syncing/);
  });

  it("prefers a successful RPC answer over a parallel 401", () => {
    const chosen = selectRpcAttempt([
      { status: 401, text: "", location: "" },
      { status: 200, text: "{}", location: "" },
    ]);
    assert.equal(chosen?.status, 200);
    const onlyDenied = selectRpcAttempt([
      { status: 0, text: "", location: "" },
      { status: 401, text: "", location: "" },
    ]);
    assert.equal(onlyDenied?.status, 401);
  });
});

describe("stack config", () => {
  it("rewrites host.docker.internal to loopback outside Docker", () => {
    assert.equal(
      localizeStackEndpoint("http://host.docker.internal:8332", {}),
      "http://127.0.0.1:8332"
    );
    assert.equal(
      localizeStackEndpoint("tcp://host.docker.internal:50111", { SCOOP_IN_DOCKER: "1" }),
      "tcp://host.docker.internal:50111"
    );
    const loaded = normalizeStackConfig(
      {
        services: [
          { id: "core-node", endpoint: "http://host.docker.internal:8332" },
          { id: "core-fulcrum", endpoint: "tcp://host.docker.internal:50111" },
        ],
      },
      {}
    );
    assert.equal(
      loaded.services.find((svc) => svc.id === "core-node")?.endpoint,
      "http://127.0.0.1:8332"
    );
    assert.equal(
      loaded.services.find((svc) => svc.id === "core-fulcrum")?.endpoint,
      "tcp://127.0.0.1:50111"
    );
  });

  it("round-trips operator paths and lists them for Explorer", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoop-stack-"));
    const file = path.join(dir, "stack.json");
    const config = normalizeStackConfig({
      services: [
        {
          id: "core-node",
          binary: path.join(dir, "bitcoind.exe"),
          datadir: path.join(dir, "Bitcoin"),
          configFile: path.join(dir, "bitcoin.conf"),
          files: [{ label: "debug log", path: path.join(dir, "debug.log") }],
        },
      ],
    });
    saveStackConfig(config, file);
    const loaded = loadStackConfig(file, {});
    const core = loaded.services.find((svc) => svc.id === "core-node");
    assert.equal(core?.configFile, path.join(dir, "bitcoin.conf"));
    assert.equal(core?.files[0]?.label, "debug log");
    const reveal = revealablePaths(loaded);
    assert.ok(reveal.includes(path.resolve(dir, "bitcoin.conf")));
    assert.ok(reveal.includes(path.resolve(dir, "debug.log")));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
