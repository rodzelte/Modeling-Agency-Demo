// CMS block validation and sanitisation. Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { isReservedSlug, parseSections, safeHref, videoEmbed } from "../../src/features/cms/blocks.ts";
import { sanitizeBlockHtml, scopeBlockCss } from "../../src/features/cms/sanitize.ts";

// OWASP XSS filter-evasion samples.
const XSS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "<svg onload=alert(1)>",
  "<a href=\"javascript:alert(1)\">x</a>",
  "<a href=\"JaVaScRiPt:alert(1)\">x</a>",
  "<a href=\"&#106;avascript:alert(1)\">x</a>",
  "<iframe src=\"https://evil.example\"></iframe>",
  "<body onload=alert(1)>",
  "<div style=\"background:url(javascript:alert(1))\">x</div>",
  "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>",
  "<form action=\"https://evil.example\"><input name=p></form>",
  "<object data=\"data:text/html,<script>alert(1)</script>\"></object>",
  "<img src=\"data:image/svg+xml,<svg onload=alert(1)>\">",
  "<meta http-equiv=\"refresh\" content=\"0;url=https://evil.example\">",
  "<a href=\"//evil.example\">x</a>",
];

test("HTML sanitiser removes every script vector", () => {
  for (const payload of XSS) {
    const clean = sanitizeBlockHtml(payload).toLowerCase();
    assert.ok(!/<script|onerror|onload|javascript:|<iframe|<object|<form|<meta|<svg|<style|data:|href="\/\//.test(clean), `${payload} → ${clean}`);
  }
});

test("HTML sanitiser keeps ordinary content", () => {
  const html = "<h2 class=\"title\">Hello</h2><p>Text with <a href=\"/models\">a link</a> and <strong>bold</strong>.</p><img src=\"https://example.com/a.jpg\" alt=\"A\">";
  const clean = sanitizeBlockHtml(html);
  assert.match(clean, /<h2 class="title">Hello<\/h2>/);
  assert.match(clean, /<a href="\/models">a link<\/a>/);
  assert.match(clean, /<img src="https:\/\/example.com\/a.jpg" alt="A" loading="lazy" \/>/);
});

test("CSS is scoped to its block and dangerous rules are dropped", () => {
  const css = `@import url(https://evil.example/x.css);
    body { background: red; }
    .card, h2 { color: blue; background: url(https://evil.example/track.png); }
    @media (min-width: 600px) { p { margin: 0; } }
    .x { width: expression(alert(1)); position: fixed; }`;
  const scoped = scopeBlockCss(css, "abc");
  assert.ok(!/@import|evil\.example|expression|<\/style|<script/i.test(scoped), scoped);
  assert.match(scoped, /\[data-cms-block="abc"\] \{ background: red; \}/);
  assert.match(scoped, /\[data-cms-block="abc"\] \.card, \[data-cms-block="abc"\] h2/);
  assert.match(scoped, /@media \(min-width: 600px\) \{ \[data-cms-block="abc"\] p/);
  assert.match(scoped, /position: relative/);
});

test("markup smuggled into CSS never survives", () => {
  for (const css of ["p { color: red } </style><script>alert(1)</script>", "</style><img src=x onerror=alert(1)>", "p{color:red}<!--"]) {
    assert.ok(!/<\/?(style|script|img)|onerror/i.test(scopeBlockCss(css, "abc")), css);
  }
});

test("links accept paths, https and mailto only", () => {
  for (const ok of ["/models", "/models/teens/boys", "https://instagram.com/x", "mailto:a@b.c", "/#contact"]) assert.ok(safeHref.safeParse(ok).success, ok);
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.example", "http://insecure.example", "vbscript:x"]) assert.ok(!safeHref.safeParse(bad).success, bad);
});

test("sections validate per block type", () => {
  const good = parseSections([{ id: "a", type: "rich_text", data: { body: "Hi" } }, { id: "b", type: "talent_grid", data: { board: "teens/boys", limit: "6" } }]);
  assert.ok(good.ok);
  if (good.ok) assert.equal((good.sections[1].data as { limit: number }).limit, 6);
  const bad = parseSections([{ id: "a", type: "cta", data: { heading: "Hi", label: "Go", href: "javascript:alert(1)" } }]);
  assert.ok(!bad.ok);
  assert.ok(!parseSections([{ id: "a", type: "unknown", data: {} }]).ok);
  assert.ok(!parseSections([{ id: "a", type: "rich_text", data: { body: "x" } }, { id: "a", type: "rich_text", data: { body: "y" } }]).ok);
});

test("reserved app paths cannot be CMS slugs", () => {
  assert.ok(isReservedSlug("models"));
  assert.ok(isReservedSlug("dashboard/x"));
  assert.ok(!isReservedSlug("about"));
});

test("video links become privacy-friendly embeds", () => {
  assert.equal(videoEmbed("https://www.youtube.com/watch?v=abcDEF12345"), "https://www.youtube-nocookie.com/embed/abcDEF12345");
  assert.equal(videoEmbed("https://vimeo.com/123456"), "https://player.vimeo.com/video/123456?dnt=1");
  assert.equal(videoEmbed("https://evil.example/v"), null);
});
