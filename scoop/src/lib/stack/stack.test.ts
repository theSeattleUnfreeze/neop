import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { loadStackConfig, normalizeStackConfig, revealablePaths, saveStackConfig } from "./config.ts";
import { summarizeStack } from "./summarize.ts";
import type { StackStatusRow } from "./types.ts";

function row(partial: Partial<StackStatusRow> & Pick<StackStatusRow, "id" | "state">): StackStatusRow {
  return {
    label: partial.id,
    control: "local",
    endpoint: "",
    height: null,
    headers: null,
    detail: "",
    configFile: "",
    datadir: "",
    files: [],
    ...partial,
  };
}

describe("stack summary", () => {
  it("is ready only when both indexers agree", () => {
    const ready = summarizeStack([
      row({ id: "core-fulcrum", state: "up", height: 100, label: "Core Fulcrum" }),
      row({ id: "knots-fulcrum", state: "up", height: 102, label: "Knots Fulcrum" }),
    ]);
    assert.equal(ready.catalogReady, true);

    const skewed = summarizeStack([
      row({ id: "core-fulcrum", state: "up", height: 100, label: "Core Fulcrum" }),
      row({ id: "knots-fulcrum", state: "up", height: 900, label: "Knots Fulcrum" }),
    ]);
    assert.equal(skewed.catalogReady, false);
    assert.match(skewed.summary, /800/);
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

describe("stack config", () => {
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
