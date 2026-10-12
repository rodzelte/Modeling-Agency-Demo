// Package share links. Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashShareToken, isShareToken, newShareToken } from "../../src/features/packages/share.ts";
import { linkState } from "../../src/features/packages/share-state.ts";

test("tokens are long, URL-safe and unique; only the hash is stored", () => {
  const tokens = new Set(Array.from({ length: 200 }, () => newShareToken()));
  assert.equal(tokens.size, 200);
  for (const token of tokens) {
    assert.ok(isShareToken(token), token);
    assert.match(hashShareToken(token), /^[0-9a-f]{64}$/);
  }
  assert.notEqual(hashShareToken("a"), hashShareToken("b"));
});

test("malformed tokens are rejected before any lookup", () => {
  for (const bad of ["", "short", "../../etc/passwd", "a".repeat(200), "has space in it and is long enough to pass length"]) assert.ok(!isShareToken(bad), bad);
});

test("link state follows sharing, expiry and revocation", () => {
  const now = Date.parse("2026-10-01T00:00:00Z");
  assert.equal(linkState({ has_link: false, expires_at: null, revoked_at: null }, now), "none");
  assert.equal(linkState({ has_link: true, expires_at: "2026-10-10T00:00:00Z", revoked_at: null }, now), "live");
  assert.equal(linkState({ has_link: true, expires_at: "2026-09-10T00:00:00Z", revoked_at: null }, now), "expired");
  assert.equal(linkState({ has_link: true, expires_at: "2026-10-10T00:00:00Z", revoked_at: "2026-09-30T00:00:00Z" }, now), "revoked");
});
