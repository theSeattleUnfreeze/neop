import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activityFromTipStates, formatActivityStamp, receivedStamp } from "./activity.ts";

describe("activity", () => {
  it("takes the later receive and spend stamps", () => {
    const early = new Date("2024-01-01T00:00:00Z");
    const late = new Date("2025-06-01T00:00:00Z");
    const { lastReceived, lastSent } = activityFromTipStates([
      { status: "unspent", confirmedHeight: 100, confirmedAt: early },
      { status: "unspent", confirmedHeight: 200, confirmedAt: late },
      { status: "spent", confirmedHeight: 150, confirmedAt: new Date("2024-06-01T00:00:00Z") },
      { status: "spent", confirmedHeight: 250, confirmedAt: new Date("2025-07-01T00:00:00Z") },
    ]);
    assert.equal(lastReceived.at?.toISOString(), late.toISOString());
    assert.equal(lastSent.height, 250);
  });

  it("reads a receive stamp from either tip of a live outpoint", () => {
    const at = new Date("2025-01-02T00:00:00Z");
    const stamp = receivedStamp(
      { status: "absent" },
      { status: "unspent", confirmedHeight: 900_000, confirmedAt: at }
    );
    assert.equal(stamp.height, 900_000);
    assert.equal(stamp.at?.toISOString(), at.toISOString());
  });

  it("formats a stamp without inventing a date", () => {
    assert.equal(formatActivityStamp({ height: null, at: null }), "—");
    assert.match(formatActivityStamp({ height: 800_000, at: null }), /800/);
  });
});
