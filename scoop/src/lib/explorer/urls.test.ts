import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_EXPLORER_CORE,
  DEFAULT_EXPLORER_KNOTS,
  isPublicExplorer,
  normalizeExplorerBase,
  resolveExplorerBases,
  txExplorerUrl,
} from "./urls.ts";

describe("explorer urls", () => {
  it("defaults to mempool.space and mempool.guide", () => {
    const bases = resolveExplorerBases({}, null);
    assert.equal(bases.core, DEFAULT_EXPLORER_CORE);
    assert.equal(bases.knots, DEFAULT_EXPLORER_KNOTS);
  });

  it("prefers env over stack over defaults", () => {
    const bases = resolveExplorerBases(
      {
        SCOOP_EXPLORER_CORE: "https://core.example/",
        SCOOP_EXPLORER_KNOTS: "https://knots.example",
      },
      { core: "https://stack-core.example", knots: "https://stack-knots.example" }
    );
    assert.equal(bases.core, "https://core.example");
    assert.equal(bases.knots, "https://knots.example");
  });

  it("uses stack when env is unset", () => {
    const bases = resolveExplorerBases(
      {},
      { core: "https://local-core.example/", knots: "http://127.0.0.1:8080" }
    );
    assert.equal(bases.core, "https://local-core.example");
    assert.equal(bases.knots, "http://127.0.0.1:8080");
  });

  it("rejects non-http bases", () => {
    assert.equal(normalizeExplorerBase("ftp://x"), "");
    assert.equal(normalizeExplorerBase("not a url"), "");
  });

  it("builds a tx path", () => {
    const txid = "ab".repeat(32);
    assert.equal(
      txExplorerUrl("https://mempool.space", txid),
      `https://mempool.space/tx/${txid}`
    );
  });

  it("treats Scoop defaults as public explorers", () => {
    assert.equal(isPublicExplorer("core", DEFAULT_EXPLORER_CORE), true);
    assert.equal(isPublicExplorer("knots", DEFAULT_EXPLORER_KNOTS + "/"), true);
    assert.equal(isPublicExplorer("core", "https://explorer.local"), false);
  });
});
