// The development seed must apply cleanly on top of every migration and must stay
// fictional. Run: npm run test:rls
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDatabase } from "./harness.mjs";

const seed = readFileSync(join(import.meta.dirname, "..", "..", "supabase", "seed.sql"), "utf8");

test("seed.sql applies after all migrations and is idempotent", async () => {
  const db = await createDatabase();
  await db.exec(seed);
  await db.exec(seed);
  const { rows: [{ n }] } = await db.query("select count(*)::int as n from public.talent where slug in ('avery-stone', 'jordan-vale', 'sam-rivers', 'casey-draft')");
  assert.equal(n, 4);
  const { rows: [{ assigned }] } = await db.query("select count(*)::int as assigned from public.talent_board_assignments a join public.talent t on t.id = a.talent_id where t.slug in ('avery-stone', 'jordan-vale', 'sam-rivers')");
  assert.equal(assigned, 3, "every seeded board slug must exist");
  const { rows } = await db.query("select slug from public.public_talents_view where slug = 'casey-draft'");
  assert.deepEqual(rows, [], "draft seed talent must not be public");
});

test("seed.sql only uses reserved example domains", () => {
  const emails = seed.match(/[\w.+-]+@[\w.-]+/g) ?? [];
  assert.ok(emails.length > 0);
  for (const email of emails) assert.match(email, /@example\.test$/, email);
});
