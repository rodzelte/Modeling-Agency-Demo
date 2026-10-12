// Runs the app in Demo Mode: `npm run demo`, `npm run demo:build`, `npm run demo:start`.
//
// Demo mode uses an in-memory sandbox instead of Supabase. This launcher turns
// the flag on and blanks every setting that points at a real service, so values
// in .env.local (or the shell) can never reach a demo process. Variables set
// here win over .env files, which only fill in what is missing.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const command = process.argv[2] ?? "dev";
if (!["dev", "build", "start"].includes(command)) {
  console.error("Usage: node scripts/demo.mjs <dev|build|start> [next options, e.g. --port 3100]");
  process.exit(1);
}

// The same name pattern as PRODUCTION_SETTING in src/demo/boot.ts (which removes
// these again inside the server, in case it is started some other way).
const production = /^(NEXT_PUBLIC_SUPABASE_|SUPABASE_|GHL_|STRIPE_|SMTP_|RESEND_|SENDGRID_|TWILIO_|POSTGRES_|PG(HOST|PORT|USER|PASSWORD|DATABASE)$|DATABASE_URL$|CRON_SECRET$|ERROR_ALERT_WEBHOOK_URL$|IMPORT_TARGET_URL$)/;

// Names that could come from the shell or from any .env file Next.js would load.
const names = new Set(Object.keys(process.env));
for (const file of [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match) names.add(match[1]);
  }
}

const env = { ...process.env, NEXT_PUBLIC_DEMO_MODE: "true" };
const blanked = [...names].filter((name) => production.test(name));
for (const name of blanked) env[name] = "";
// Sample bookings are written in the agency's home time zone; show them that way
// wherever the demo happens to be hosted (override with TZ=...).
if (!env.TZ) env.TZ = "America/Chicago";

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
console.log(`\n  42 Model Management — DEMO MODE (${command})\n  In-memory sandbox · sample data only · no connection to Supabase, GHL or email\n`);
if (blanked.length) console.log(`  Ignoring ${blanked.length} real-service setting(s) found in the environment: ${blanked.sort().join(", ")}\n`);
const child = spawn(process.execPath, [next, command, ...process.argv.slice(3)], { stdio: "inherit", env });
child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
