// Boots the demo sandbox exactly as the app does (stand-ins, every migration,
// supabase/demo/seed.sql, generated files) and prints what it contains.
// Run from the repository root: node scripts/demo/check-seed.mts
import { getSandbox } from "../../src/demo/sandbox/database.ts";
import { seedDemo } from "../../src/demo/seed/index.ts";

const started = Date.now();
const sandbox = await getSandbox(seedDemo);
const { db } = sandbox;

const tables = (await db.query<{ name: string }>(
  "select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1",
)).rows;
const counts: [string, number][] = [];
for (const { name } of tables) {
  counts.push([name, (await db.query<{ n: number }>(`select count(*)::int as n from public."${name}"`)).rows[0].n]);
}
const empty = counts.filter(([, n]) => n === 0).map(([name]) => name);
console.log("Rows per table:");
for (const [name, n] of counts.filter(([, n]) => n > 0)) console.log(`  ${name.padEnd(32)} ${n}`);
console.log(`\nEmpty tables (${empty.length}): ${empty.join(", ") || "none"}`);

// What an anonymous website visitor can see.
const asAnon = async (sql: string) => db.transaction(async (tx) => {
  await tx.exec("set local role anon");
  return (await tx.query<{ n: number }>(sql)).rows[0].n;
});
console.log("\nPublic website (anonymous role):");
console.log(`  talents   ${await asAnon("select count(*)::int as n from public.public_talents_view")}`);
console.log(`  boards    ${await asAnon("select count(*)::int as n from public.public_boards_view")}`);
console.log(`  media     ${await asAnon("select count(*)::int as n from public.public_talent_media_view")}`);
console.log(`  pages     ${await asAnon("select count(*)::int as n from public.public_pages_view")}`);

const unbound = (await db.query<{ email: string }>("select email from public.agency_members where user_id is null and status = 'active'")).rows;
console.log(`\nActive members without a sign-in account: ${unbound.map((row) => row.email).join(", ") || "none"}`);
console.log(`Files: ${sandbox.files.size} (${Math.round([...sandbox.files.values()].reduce((sum, file) => sum + file.bytes.byteLength, 0) / 1024)} KB)`);
console.log(`Booted and seeded in ${Date.now() - started} ms`);
await db.close();
