/**
 * Unit tests for API error handling and responses.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleRouteError, jsonResponse } from "../../lib/api";
import { NotSignedIn } from "../../lib/auth";
import { ContractRevert } from "../../lib/chain";

describe("api helpers", () => {
  it("formats jsonResponse with default 200 status", async () => {
    const res = jsonResponse({ hello: "world" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { hello: "world" });
  });

  it("handles NotSignedIn error with 401 status", async () => {
    const res = handleRouteError(new NotSignedIn("sign in required"));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, "sign in required");
  });

  it("handles ContractRevert error with 400 status and revert flag", async () => {
    const res = handleRouteError(
      new ContractRevert("only the lender can draft covenants", "add_covenant"),
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "only the lender can draft covenants");
    assert.equal(body.revert, true);
    assert.equal(body.label, "add_covenant");
  });

  it("handles generic Error with 500 status", async () => {
    const res = handleRouteError(new Error("unexpected database error"));
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, "unexpected database error");
  });
});
