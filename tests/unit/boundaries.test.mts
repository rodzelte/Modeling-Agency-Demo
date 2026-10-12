// Architecture guard rails that TypeScript cannot express. Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = join(import.meta.dirname, "..", "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const sources = files(join(root, "src")).map((path) => ({ path: relative(root, path).split(sep).join("/"), text: readFileSync(path, "utf8") }));

// The service-role client bypasses RLS: only integrations without a user session may use it.
// The GHL sync engine is the one shared module; its callers authenticate first
// (webhook secret, CRON_SECRET, or requireApi("integrations.manage")).
const ADMIN_ALLOWED = ["src/app/api/integrations/ghl/route.ts", "src/features/ghl/engine.ts"];

test("only authenticated entry points use the GHL sync engine", () => {
  const importers = sources.filter((file) => /from\s+["']@\/features\/ghl\/engine["']/.test(file.text)).map((file) => file.path).sort();
  assert.deepEqual(importers, [
    "src/app/api/dashboard/ghl/conflicts/[id]/route.ts",
    "src/app/api/dashboard/ghl/contacts/[id]/talent/route.ts",
    "src/app/api/dashboard/ghl/route.ts",
    "src/app/api/integrations/ghl/events/route.ts",
    "src/app/api/integrations/ghl/route.ts",
    "src/app/api/integrations/ghl/sync/route.ts",
  ]);
  for (const path of importers.filter((file) => file.startsWith("src/app/api/dashboard/"))) {
    assert.match(sources.find((file) => file.path === path)!.text, /requireApi\(\s*(\[\s*)?"integrations\.manage"/, `${path} must require integrations.manage`);
  }
});

test("the GHL API token is read only by the server-side GHL client", () => {
  const readers = sources.filter((file) => /process\.env\.GHL_API_TOKEN|env\[["']GHL_API_TOKEN/.test(file.text)).map((file) => file.path);
  assert.deepEqual(readers, ["src/features/ghl/client.ts"]);
});

test("only allow-listed server integrations import the admin (service-role) client", () => {
  const importers = sources.filter((file) => /from\s+["']@\/lib\/supabase\/admin["']/.test(file.text)).map((file) => file.path);
  assert.deepEqual(importers.sort(), ADMIN_ALLOWED.sort());
});

test("no client component imports server-only modules", () => {
  const offenders = sources.filter((file) => /^\s*["']use client["']/m.test(file.text)
    && /from\s+["'](@\/lib\/supabase\/(admin|server)|@\/lib\/agency-auth|@\/features\/applications\/ingest|@\/features\/portal\/context|@\/features\/compcard\/build|@\/features\/packages\/share|next\/headers)["']/.test(file.text));
  assert.deepEqual(offenders.map((file) => file.path), []);
});

test("the secret key is read only by the admin client", () => {
  const readers = sources.filter((file) => /SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/.test(file.text)).map((file) => file.path);
  assert.deepEqual(readers, ["src/lib/supabase/admin.ts"]);
});

test("no NEXT_PUBLIC_ variable carries a secret", () => {
  const leaks = sources.filter((file) => /NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE_ROLE|TOKEN|PASSWORD)/.test(file.text)).map((file) => file.path);
  assert.deepEqual(leaks, []);
});
