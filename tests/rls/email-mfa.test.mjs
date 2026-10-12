// Phase 19b: emailed code as the second sign-in step (migration 028).
// Run: node --test tests/rls/email-mfa.test.mjs
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { addMember, createDatabase, newUser, users } from "./harness.mjs";

let db;
const su = async (sql, params) => (await db.query(sql, params)).rows;
const now = () => Math.floor(Date.now() / 1000);

// A session as Supabase issues it: sign-in methods ("amr") and a session id.
function session(user, method, { age = 0, id = randomUUID() } = {}) {
  return { user, id, claims: { sub: user.id, email: user.email, role: "authenticated", session_id: id, amr: [{ method, timestamp: now() - age }] } };
}
async function call(s, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(s.claims)]);
    await tx.exec("set local role authenticated");
    return (await tx.query(sql, params)).rows[0];
  });
}
const fails = (s, sql, params) => call(s, sql, params).then(() => false, () => true);
const start = async (s) => (await call(s, "select public.start_email_mfa() as nonce")).nonce;
const complete = async (s, nonce) => (await call(s, "select public.complete_email_mfa($1) as ok", [nonce])).ok;
const verified = async (s) => (await call(s, "select public.email_mfa_verified() as ok")).ok;

let admin;
before(async () => {
  db = await createDatabase();
  admin = await addMember(db, newUser("admin"), "administrator");
});

describe("phase 19b: emailed sign-in codes", () => {
  test("password sign-in, then the code from the same browser, verifies the new session", async () => {
    const nonce = await start(session(admin, "password"));
    const otp = session(admin, "otp");
    assert.equal(await verified(otp), false);
    assert.equal(await complete(otp, nonce), true);
    assert.equal(await verified(otp), true);
    assert.equal(await verified(session(admin, "otp")), false, "another session is not verified");
    assert.equal(await complete(session(admin, "otp"), nonce), false, "a nonce works once");
    const [audit] = await su("select count(*)::int as n from public.audit_logs where action = 'auth.email_code_verified' and actor_id = $1", [admin.id]);
    assert.equal(audit.n, 1);
  });

  test("the mailbox alone is not enough: no password session, no challenge", async () => {
    assert.ok(await fails(session(admin, "otp"), "select public.start_email_mfa()"));
    assert.ok(await fails(session(admin, "password", { age: 7200 }), "select public.start_email_mfa()"), "stale password sign-in");
    assert.equal(await complete(session(admin, "otp"), "guessed-nonce"), false);
  });

  test("the code session must be fresh, and the nonce must belong to the same person", async () => {
    const nonce = await start(session(admin, "password"));
    assert.equal(await complete(session(admin, "otp", { age: 900 }), nonce), false, "old code session");
    assert.equal(await complete(session(admin, "password"), nonce), false, "not a code session");
    const other = await addMember(db, newUser("other"), "administrator");
    assert.equal(await complete(session(other, "otp"), nonce), false, "someone else's nonce");
    assert.equal(await complete(session(admin, "otp"), nonce), true);
  });

  test("verification lasts 30 days", async () => {
    const otp = session(admin, "otp");
    assert.equal(await complete(otp, await start(session(admin, "password"))), true);
    await su("update public.mfa_email_sessions set verified_at = now() - interval '31 days' where session_id = $1", [otp.id]);
    assert.equal(await verified(otp), false);
  });

  test("codes are rate limited and only for active team members", async () => {
    const busy = await addMember(db, newUser("busy"), "administrator");
    for (let i = 0; i < 5; i += 1) await start(session(busy, "password"));
    assert.ok(await fails(session(busy, "password"), "select public.start_email_mfa()"));
    assert.ok(await fails(session(users.outsider, "password"), "select public.start_email_mfa()"));
  });

  test("the tables are reachable only through the functions", async () => {
    assert.ok(await fails(session(admin, "password"), "select * from public.mfa_email_challenges"));
    assert.ok(await fails(session(admin, "otp"), "insert into public.mfa_email_sessions (session_id, user_id) values ($1, $2)", [randomUUID(), admin.id]));
    assert.ok(await fails(session(admin, "otp"), "select public.session_signed_in_with('otp', 600)"));
  });
});
