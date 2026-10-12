// Team profile photo URL helpers. Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { profilePhotoPath, profilePhotoUrl } from "../../src/features/team/photo.ts";

const url = "https://abc.supabase.co/storage/v1/object/public/team-avatars/user-1/1700000000000.jpg";

test("uploaded photos are used and their storage path is recovered", () => {
  assert.equal(profilePhotoUrl({ profile_photo_url: url }), url);
  assert.equal(profilePhotoPath(url), "user-1/1700000000000.jpg");
  assert.equal(profilePhotoPath(`${url}?v=2`), "user-1/1700000000000.jpg");
});

test("Google pictures and other URLs are ignored (the CSP would block them)", () => {
  assert.equal(profilePhotoUrl({ avatar_url: "https://lh3.googleusercontent.com/a/x" }), null);
  assert.equal(profilePhotoUrl({ profile_photo_url: "https://example.com/me.jpg" }), null);
  assert.equal(profilePhotoUrl({ profile_photo_url: null }), null);
  assert.equal(profilePhotoUrl(undefined), null);
});

test("emailed-code confirmations show a masked address", async () => {
  const { maskEmail } = await import("../../src/features/auth/email-code.ts");
  assert.equal(maskEmail("marie@42modelmanagement.com"), "m•••e@42modelmanagement.com");
  assert.equal(maskEmail("jo@example.com"), "j@example.com");
});
