import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { confirmationGauge } from "./gauge.ts";

describe("confirmation gauge", () => {
  it("stays empty in the mempool and fills through six", () => {
    assert.equal(confirmationGauge("mempool", 0).filled, 0);
    assert.equal(confirmationGauge("mempool", 0).alert, false);
    assert.equal(confirmationGauge("confirmed", 3).filled, 3);
    assert.equal(confirmationGauge("confirmed", 3).text, "3 of 6 confirmations.");
    assert.equal(confirmationGauge("confirmed", 9).filled, 6);
  });

  it("alerts on a reorg", () => {
    const gauge = confirmationGauge("reorged", 4);
    assert.equal(gauge.alert, true);
    assert.match(gauge.text, /replaced/);
  });
});
