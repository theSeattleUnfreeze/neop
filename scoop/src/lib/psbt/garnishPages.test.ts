import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { garnishPageOrder } from "./garnishPages.ts";

describe("garnish page order", () => {
  it("starts on the current page and then wraps to the front", () => {
    assert.deepEqual(garnishPageOrder(0, 3), [0, 1, 2]);
    assert.deepEqual(garnishPageOrder(1, 3), [1, 2, 0]);
  });
});
