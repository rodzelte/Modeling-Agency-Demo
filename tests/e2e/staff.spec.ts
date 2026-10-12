import { expect, test } from "@playwright/test";

// Signed-in, read-only smoke test. Runs only when a dedicated test account is
// provided (E2E_EMAIL / E2E_PASSWORD, e.g. a read_only member); it never writes.
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe("staff dashboard (read-only)", () => {
  test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD to run signed-in checks");

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/work email/i).fill(email!);
    await page.getByLabel(/^password/i).fill(password!);
    await page.getByRole("button", { name: /sign in with email/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("overview, talent list, boards and search load", async ({ page }) => {
    await expect(page.getByRole("navigation", { name: "Dashboard" })).toBeVisible();
    for (const [path, heading] of [["/dashboard/talent", /talent/i], ["/dashboard/boards", /boards/i], ["/dashboard/search?q=a", /search/i]] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(heading);
    }
  });
});
