import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { localOnly } from "./localOnly.ts";

describe("localOnly", () => {
  it("allows requests with the localhost UI header", () => {
    const req = new Request("http://127.0.0.1/", { headers: { "x-scoop-local": "1" } });
    assert.equal(localOnly(req), null);
  });

  it("rejects requests without the header", () => {
    const req = new Request("http://127.0.0.1/");
    const res = localOnly(req);
    assert.ok(res);
    assert.equal(res.status, 403);
  });

  it("rejects a non-loopback host even with the header", () => {
    const req = new Request("http://evil.example/", { headers: { "x-scoop-local": "1" } });
    const res = localOnly(req);
    assert.equal(res?.status, 403);
  });
});
