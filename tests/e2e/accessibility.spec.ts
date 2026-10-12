import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// WCAG 2.2 A/AA automated checks on the public pages and sign-in screens.
// Automated checks find roughly a third of issues; the manual keyboard and
// screen-reader pass is in docs/launch-checklist.md.
const PAGES = ["/", "/models", "/models?heightMin=160", "/login", "/login/forgot", "/portal/login", "/this-page-does-not-exist-e2e"];

for (const path of PAGES) {
  test(`no WCAG A/AA violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const summary = results.violations.map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
    expect(summary).toEqual([]);
  });
}
