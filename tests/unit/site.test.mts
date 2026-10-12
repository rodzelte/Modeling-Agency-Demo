// NEXT_PUBLIC_SITE_URL parsing. Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { siteOrigin } from "../../src/lib/site.ts";

test("site origin accepts the usual ways of writing an address", () => {
  assert.equal(siteOrigin("https://www.42modelmanagement.com"), "https://www.42modelmanagement.com");
  assert.equal(siteOrigin("https://www.42modelmanagement.com/"), "https://www.42modelmanagement.com");
  assert.equal(siteOrigin("  https://example.com/some/path  "), "https://example.com");
  assert.equal(siteOrigin("http://localhost:3000"), "http://localhost:3000");
});

test("site origin adds https:// when the scheme is missing", () => {
  assert.equal(siteOrigin("42-model-management.vercel.app"), "https://42-model-management.vercel.app");
  assert.equal(siteOrigin("www.42modelmanagement.com/"), "https://www.42modelmanagement.com");
});

test("an unset or invalid address is ignored instead of throwing", () => {
  // With no argument it reads NEXT_PUBLIC_SITE_URL, which CI sets; clear it here.
  const saved = process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  try {
    assert.equal(siteOrigin(), null);
  } finally {
    if (saved !== undefined) process.env.NEXT_PUBLIC_SITE_URL = saved;
  }
  assert.equal(siteOrigin(""), null);
  assert.equal(siteOrigin("   "), null);
  assert.equal(siteOrigin("https://<your-domain>"), null);
  assert.equal(siteOrigin("not a url"), null);
  assert.equal(siteOrigin("ftp://example.com"), null);
});
