import { expect, test } from "@playwright/test";

// Anonymous visitor checks against real data. They never write anything.
test.describe("public site", () => {
  test("home page renders with navigation and security headers", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    const headers = response!.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["x-powered-by"]).toBeUndefined();
    await expect(page.getByRole("link", { name: /42 Model Management/i }).first()).toBeVisible();
  });

  test("roster page lists talent or an empty state", async ({ page }) => {
    await page.goto("/models");
    await expect(page.locator("main")).toContainText(/talent/i);
  });

  test("unknown profile paths return a real 404", async ({ page }) => {
    const response = await page.goto("/models/this-talent-does-not-exist-e2e");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();
  });

  test("the page never has horizontal overflow", async ({ page }) => {
    for (const path of ["/", "/models", "/login"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(1);
    }
  });

  test("robots and sitemap are served", async ({ request }) => {
    expect((await request.get("/robots.txt")).status()).toBe(200);
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain("<urlset");
  });
});

test.describe("signed-out access", () => {
  test("the dashboard redirects to sign in", async ({ page }) => {
    await page.goto("/dashboard/talent");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Ftalent/);
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
  });

  test("staff previews require sign in", async ({ page }) => {
    await page.goto("/preview/talent/00000000-0000-0000-0000-000000000000");
    await expect(page).toHaveURL(/\/login/);
  });

  test("dashboard APIs reject anonymous callers", async ({ request }) => {
    const response = await request.get("/api/dashboard/talents");
    expect([401, 403, 405]).toContain(response.status());
  });

  test("forgot-password page is reachable from sign in", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: /forgot your password/i }).click();
    await expect(page.getByRole("heading", { name: /reset your password/i })).toBeVisible();
  });

  test("an external next= target is ignored", async ({ page }) => {
    await page.goto("/auth/callback?next=//evil.example");
    await expect(page).toHaveURL(/\/login\?error=/);
  });
});

test.describe("roster search", () => {
  test("filters live in the URL and survive a reload", async ({ page }) => {
    await page.goto("/models?heightMin=160&sort=name");
    await expect(page.getByLabel("Sort")).toHaveValue("name");
    await page.reload();
    await expect(page.getByLabel("Min height")).toHaveValue("160");
    const robots = await page.locator('meta[name="robots"]').getAttribute("content");
    expect(robots).toContain("noindex");
  });

  test("invalid parameters are ignored rather than erroring", async ({ page }) => {
    const response = await page.goto("/models?heightMin=abc&board=../../etc&page=-4");
    expect(response?.status()).toBe(200);
  });

  test("a page past the end shows the empty state", async ({ page }) => {
    await page.goto("/models?page=400");
    await expect(page.getByText(/no talent matches/i)).toBeVisible();
  });

  test("the name search submits to a shareable URL", async ({ page }) => {
    await page.goto("/models");
    await page.getByPlaceholder("Name or city").fill("zzzz-no-match");
    await page.getByPlaceholder("Name or city").press("Enter");
    await expect(page).toHaveURL(/q=zzzz-no-match/);
    await expect(page.getByText(/no talent matches/i)).toBeVisible();
  });
});

test.describe("GHL integration", () => {
  test("the webhook refuses unauthenticated calls", async ({ request }) => {
    const response = await request.post("/api/integrations/ghl", { data: { contact_id: "e2e", email: "e2e@example.test" } });
    expect([401, 503]).toContain(response.status());
  });

  test("/join sends visitors to the GHL registration form", async ({ request }) => {
    const response = await request.get("/join", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe("https://funnel.modelluxemedia.com/registration-form");
  });
});

test.describe("CMS routes", () => {
  test("unknown top-level pages return a real 404", async ({ page }) => {
    const response = await page.goto("/this-page-does-not-exist-e2e");
    expect(response?.status()).toBe(404);
  });

  test("app paths cannot be shadowed by CMS slugs", async ({ page }) => {
    const response = await page.goto("/dashboard");
    expect(page.url()).toMatch(/\/login/);
    expect(response?.status()).toBeLessThan(400);
  });

  test("the home page uses no stock photography", async ({ page }) => {
    await page.goto("/");
    const sources = await page.locator("img").evaluateAll((images) => images.map((image) => (image as HTMLImageElement).currentSrc || (image as HTMLImageElement).src));
    expect(sources.filter((src) => src.includes("unsplash"))).toEqual([]);
  });
});

test.describe("operations exports", () => {
  test("calendar and finance exports require sign-in", async ({ request }) => {
    for (const path of ["/api/dashboard/calendar/ics?talent=00000000-0000-0000-0000-000000000000", "/api/dashboard/finance/export"]) {
      const response = await request.get(path);
      expect([401, 403], path).toContain(response.status());
    }
  });
});

test.describe("client packages", () => {
  test("unknown or malformed package links return 404 and are never indexed", async ({ page }) => {
    for (const token of ["nope", "A".repeat(43)]) {
      const response = await page.goto(`/p/${token}`);
      expect(response?.status()).toBe(404);
      expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    }
  });

  test("comp cards and roster exports require sign-in", async ({ request }) => {
    for (const path of ["/api/dashboard/talents/00000000-0000-0000-0000-000000000000/comp-card", "/api/dashboard/talents/export"]) {
      expect([401, 403], path).toContain((await request.get(path)).status());
    }
  });
});

test.describe("talent portal", () => {
  test("the portal requires sign-in and offers a magic link", async ({ page }) => {
    await page.goto("/portal/profile");
    await expect(page).toHaveURL(/\/portal\/login/);
    await expect(page.getByRole("button", { name: /email me a sign-in link/i })).toBeVisible();
  });

  test("portal APIs reject anonymous callers", async ({ request }) => {
    const response = await request.post("/api/portal/requests", { data: { field_group: "contact", changes: { mobile: "1" } } });
    expect(response.status()).toBe(401);
  });
});

test.describe("content security policy", () => {
  test("pages load and hydrate with no CSP violations", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (message) => { if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text()); });
    for (const path of ["/", "/models", "/login", "/portal/login"]) {
      const response = await page.goto(path);
      expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    }
    // Client-side interactivity still works under the policy.
    await page.goto("/models");
    await page.getByRole("button", { name: /filters/i }).click();
    await expect(page.getByLabel("Gender")).toBeVisible();
    expect(violations).toEqual([]);
  });
});
