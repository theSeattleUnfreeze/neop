import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { syncView } from "./syncView.ts";
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

describe("syncView", () => {
  it("shows a syncing node height against headers and verification progress", () => {
    const view = syncView(
      row({
        id: "core-node",
        state: "up",
        height: 100,
        headers: 400,
        progress: 0.25,
      })
    );
    assert.equal(view?.ratio, 0.25);
    assert.match(view?.label ?? "", /height 100/);
    assert.match(view?.label ?? "", /headers 400/);
    assert.match(view?.label ?? "", /25\.0%/);
  });

  it("drops the bar once the node is caught up", () => {
    const view = syncView(
      row({ id: "core-node", state: "up", height: 400, headers: 400, progress: 1 })
    );
    assert.equal(view?.ratio, null);
    assert.equal(view?.label, "height 400");
  });

  it("draws Fulcrum against the node block count", () => {
    const node = row({ id: "core-node", state: "up", height: 1000, headers: 1000, progress: 1 });
    const behind = syncView(row({ id: "core-fulcrum", state: "up", height: 250 }), node);
    assert.equal(behind?.ratio, 0.25);
    assert.equal(behind?.label, "250 of 1,000 blocks");
    const caught = syncView(row({ id: "core-fulcrum", state: "up", height: 998 }), node);
    assert.equal(caught?.ratio, null);
    assert.match(caught?.label ?? "", /caught up/);
  });

  it("keeps Fulcrum’s own tip when the node has no height", () => {
    const view = syncView(
      row({ id: "core-fulcrum", state: "up", height: 10 }),
      row({ id: "core-node", state: "down" })
    );
    assert.equal(view?.ratio, null);
    assert.equal(view?.label, "tip 10");
  });

  it("returns nothing for a node that is down", () => {
    assert.equal(syncView(row({ id: "core-node", state: "down", detail: "connect ECONNREFUSED" })), null);
  });
});
