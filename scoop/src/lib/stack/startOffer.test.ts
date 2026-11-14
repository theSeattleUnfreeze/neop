import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { localServicesToStart } from "./startOffer.ts";

describe("localServicesToStart", () => {
  it("offers configured local services that are stopped, in stack order", () => {
    const offers = localServicesToStart([
      { id: "core-node", label: "Core", canStart: true },
      { id: "core-fulcrum", label: "Core Fulcrum", canStart: true },
      { id: "knots-node", label: "Knots", canStart: false },
      { id: "knots-fulcrum", label: "Knots Fulcrum", canStart: false },
      { id: "knots-link", label: "Knots tunnel", canStart: true },
    ]);
    assert.deepEqual(
      offers.map((row) => row.id),
      ["core-node", "core-fulcrum"]
    );
  });

  it("offers nothing when every startable service is already up", () => {
    assert.deepEqual(
      localServicesToStart([
        { id: "core-node", label: "Core", canStart: false },
        { id: "core-fulcrum", label: "Core Fulcrum", canStart: false },
      ]),
      []
    );
  });
});
