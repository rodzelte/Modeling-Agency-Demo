// Two-step sign-in policy: when a Google sign-in counts as the second step. Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { GOOGLE_SIGN_IN_TRUST_DAYS, recentGoogleSignIn } from "../../src/lib/mfa-policy.ts";

const now = 1_800_000_000;
const day = 86400;

test("a recent Google sign-in counts as verified", () => {
  assert.equal(recentGoogleSignIn([{ method: "oauth", timestamp: now - 60 }], ["google"], now), true);
  assert.equal(recentGoogleSignIn([{ method: "oauth", timestamp: now - (GOOGLE_SIGN_IN_TRUST_DAYS - 1) * day }], ["email", "google"], now), true);
});

test("an old Google sign-in must be refreshed", () => {
  assert.equal(recentGoogleSignIn([{ method: "oauth", timestamp: now - (GOOGLE_SIGN_IN_TRUST_DAYS + 1) * day }], ["google"], now), false);
});

test("password, email-link and code sign-ins never skip the step", () => {
  assert.equal(recentGoogleSignIn([{ method: "password", timestamp: now }], ["email", "google"], now), false);
  assert.equal(recentGoogleSignIn([{ method: "otp", timestamp: now }], ["google"], now), false);
  assert.equal(recentGoogleSignIn([{ method: "magiclink", timestamp: now }], ["google"], now), false);
});

test("an oauth sign-in only counts when the account is linked to Google", () => {
  assert.equal(recentGoogleSignIn([{ method: "oauth", timestamp: now }], ["email"], now), false);
  assert.equal(recentGoogleSignIn([{ method: "oauth", timestamp: now }], undefined, now), false);
});

test("missing or malformed data is never trusted", () => {
  assert.equal(recentGoogleSignIn(undefined, ["google"], now), false);
  assert.equal(recentGoogleSignIn([], ["google"], now), false);
  assert.equal(recentGoogleSignIn(["oauth"], ["google"], now), false); // no timestamp
  assert.equal(recentGoogleSignIn([{ method: "oauth", timestamp: now + 7 * day }], ["google"], now), false); // future
});
