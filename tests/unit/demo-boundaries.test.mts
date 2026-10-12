// Guard rails for Demo Mode (docs/demo-mode.md): a demo build can only reach the
// in-memory sandbox, and a production build never loads demo code.
// Run: npm run test:unit
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
const source = (path: string) => sources.find((file) => file.path === path)!.text;
const LITERAL_FLAG = /process\.env\.NEXT_PUBLIC_DEMO_MODE\s*[!=]==\s*"true"/;

test("every Supabase client is created by a factory that switches to the sandbox in demo mode", () => {
  const creators = sources.filter((file) => /\b(createServerClient|createBrowserClient)\(|from\s+["']@supabase\/supabase-js["'][\s\S]*\bcreateClient\(/.test(file.text)
    && /import\s+\{[^}]*\b(createServerClient|createBrowserClient|createClient)\b[^}]*\}\s+from\s+["']@supabase\/(ssr|supabase-js)["']/.test(file.text)).map((file) => file.path).sort();
  assert.deepEqual(creators, ["src/lib/supabase/admin.ts", "src/lib/supabase/client.ts", "src/lib/supabase/proxy.ts", "src/lib/supabase/public.ts", "src/lib/supabase/server.ts"]);
  for (const path of ["src/lib/supabase/admin.ts", "src/lib/supabase/proxy.ts", "src/lib/supabase/public.ts", "src/lib/supabase/server.ts"]) {
    assert.match(source(path), /\.\.\.sandboxOptions\(\)/, `${path} must pass sandboxOptions() to its client`);
  }
  assert.match(source("src/lib/supabase/client.ts"), LITERAL_FLAG);
  // Demo mode returns before any project setting or secret is read.
  const env = source("src/lib/env.ts");
  assert.ok(env.indexOf("if (DEMO_MODE) return") !== -1 && env.indexOf("if (DEMO_MODE) return") < env.indexOf("process.env.NEXT_PUBLIC_SUPABASE_URL"));
  const admin = source("src/lib/supabase/admin.ts");
  assert.ok(admin.indexOf("if (DEMO_MODE)") !== -1 && admin.indexOf("if (DEMO_MODE)") < admin.indexOf("process.env.SUPABASE_SECRET_KEY"));
});

test("demo code is loaded only behind the build-time flag", () => {
  const outside = sources.filter((file) => !file.path.startsWith("src/demo/") && /["']@\/demo\//.test(file.text));
  for (const file of outside) {
    // The sample sign-in list is plain data (no sandbox code) and is itself only rendered in demo builds.
    if (file.path === "src/features/demo/DemoAccounts.tsx") {
      assert.deepEqual([...file.text.matchAll(/from\s+["'](@\/demo\/[^"']+)["']/g)].map((match) => match[1]), ["@/demo/accounts"]);
      continue;
    }
    assert.doesNotMatch(file.text, /from\s+["']@\/demo\//, `${file.path} must not import demo code statically`);
    assert.match(file.text, LITERAL_FLAG, `${file.path} must check NEXT_PUBLIC_DEMO_MODE literally before loading demo code`);
  }
  assert.deepEqual(outside.map((file) => file.path).sort(), [
    "src/app/api/demo/login/route.ts",
    "src/app/api/demo/reset/route.ts",
    "src/app/api/demo/status/route.ts",
    "src/app/api/demo/supabase/[...path]/route.ts",
    "src/app/demo/route.ts",
    "src/features/demo/DemoAccounts.tsx",
    "src/features/ghl/client.ts",
    "src/instrumentation.ts",
    "src/lib/supabase/sandbox.ts",
  ]);
  // The demo UI is pulled in the same way.
  for (const file of sources.filter((candidate) => !candidate.path.startsWith("src/features/demo/") && /@\/features\/demo\//.test(candidate.text))) {
    assert.doesNotMatch(file.text, /from\s+["']@\/features\/demo\//, `${file.path} must not import demo UI statically`);
    assert.match(file.text, LITERAL_FLAG, `${file.path} must check NEXT_PUBLIC_DEMO_MODE literally`);
  }
});

test("every demo-only route answers 404 outside demo mode", () => {
  for (const file of sources.filter((candidate) => candidate.path.startsWith("src/app/api/demo/"))) {
    assert.match(file.text, /process\.env\.NEXT_PUBLIC_DEMO_MODE !== "true"\) return NextResponse\.json\(\{ error: "Not found" \}, \{ status: 404 \}\)/, file.path);
  }
});

test("the sandbox holds no real service address and never uses the admin client", () => {
  for (const file of sources.filter((candidate) => candidate.path.startsWith("src/demo/"))) {
    assert.doesNotMatch(file.text, /supabase\.co\b|leadconnectorhq\.com|gohighlevel\.com|cdsglobal\.com|webforfashion\.com|amazonaws\.com/i, `${file.path} names a real service's address`);
    assert.doesNotMatch(file.text, /@\/lib\/supabase\/admin/, `${file.path} imports the admin client`);
    // Allowed: the sandbox placeholder, the SVG namespace, this machine, and this site's own host (remote.ts).
    assert.doesNotMatch(file.text, /https?:\/\/(?!sandbox\.demo\.invalid|www\.w3\.org|127\.0\.0\.1|\$\{host\})/, `${file.path} contains an outside address`);
  }
});

test("inbound integrations and real outbound calls are switched off in demo mode", () => {
  for (const path of ["src/app/api/integrations/ghl/route.ts", "src/app/api/integrations/ghl/events/route.ts", "src/app/api/integrations/ghl/sync/route.ts"]) {
    assert.match(source(path), /NEXT_PUBLIC_DEMO_MODE === "true"\) return NextResponse\.json\(\{ error: "Integrations are switched off in demo mode" \}, \{ status: 404 \}\)/, path);
  }
  // The GHL client answers from the stand-in before it reads the token or calls fetch.
  const ghl = source("src/features/ghl/client.ts");
  const request = ghl.slice(ghl.indexOf("export async function ghlRequest"));
  assert.ok(request.indexOf("demoGhlRequest") !== -1 && request.indexOf("demoGhlRequest") < request.indexOf("process.env.GHL_API_TOKEN"));
  assert.ok(request.indexOf("demoGhlRequest") < request.indexOf("await fetch("));
  // The public contact address and the application form are replaced.
  const site = source("src/lib/site.ts");
  assert.match(site, /CONTACT_EMAIL = DEMO \? "[^"]+\.example"/);
  assert.match(site, /JOIN_URL = DEMO \? "\/demo\/join"/);
});

test("the demo seed is fictional", () => {
  const seed = readFileSync(join(root, "supabase", "demo", "seed.sql"), "utf8");
  const emails = [...seed.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((match) => match[0].toLowerCase());
  assert.ok(emails.length > 20, "the seed contains sample people");
  assert.deepEqual([...new Set(emails.filter((email) => !email.endsWith(".example")))], [], "every email address uses a reserved .example domain");
  assert.doesNotMatch(seed, /42modelmanagement\.com|modelluxemedia|supabase\.co/i);
});
