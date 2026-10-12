// Fills a freshly migrated sandbox with the fictional sample data:
//   1. sign-in accounts for the demo people (src/demo/accounts.ts),
//   2. supabase/demo/seed.sql — every module's records,
//   3. generated placeholder images and files for everything the records point to.
// It runs as the database superuser, once per boot; "Reset demo data" restores
// the snapshot taken right after it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "../accounts.ts";
import type { StoredFile } from "../sandbox/database.ts";
import { seedFiles } from "./files.ts";

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

export async function seedDemo(db: PGlite, files: Map<string, StoredFile>): Promise<void> {
  // Confirmed Auth users first, so the seed's agency_members rows bind to them
  // the same way an approved teammate's account does in production.
  const users = DEMO_ACCOUNTS.map((account) =>
    `(${quote(account.id)}, ${quote(account.email)}, crypt(${quote(DEMO_PASSWORD)}, gen_salt('bf', 4)), now(), ${quote(JSON.stringify({ full_name: account.name }))}::jsonb)`);
  await db.exec(`insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data) values ${users.join(",\n")};`);
  await db.exec(readFileSync(join(process.cwd(), "supabase", "demo", "seed.sql"), "utf8"));
  await seedFiles(db, files);
}
