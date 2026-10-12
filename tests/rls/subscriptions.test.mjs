// Phase 21: talent subscriptions (migration 031). Paid access is decided in the
// database, so the website and a future mobile app obey the same rule.
// Run: node --test tests/rls/subscriptions.test.mjs
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { addMember, as, createDatabase, newUser, rejects, rowsAs, users } from "./harness.mjs";

let db;
const su = async (sql, params) => (await db.query(sql, params)).rows;
let talentA;
let talentB;
let ana;
let ben;
const entitled = async (user) => (await as(db, user, "select public.has_entitlement('portal.full') as ok")).rows[0].ok;
const requestChange = (user, talentId) => as(db, user, `insert into public.talent_change_requests (talent_id, field_group, changes) values ('${talentId}', 'contact', '{"mobile":"555-0101"}')`);

before(async () => {
  db = await createDatabase();
  talentA = (await su("insert into public.talent (slug, first_name, last_name, display_name) values ('sub-a', 'Ana', 'A', 'Ana') returning id"))[0].id;
  talentB = (await su("insert into public.talent (slug, first_name, last_name, display_name) values ('sub-b', 'Ben', 'B', 'Ben') returning id"))[0].id;
  ana = await addMember(db, newUser("sub-ana"), "talent", talentA);
  ben = await addMember(db, newUser("sub-ben"), "talent", talentB);
});

describe("phase 21: subscriptions", () => {
  test("while subscriptions are not required, every talent keeps full access", async () => {
    assert.equal(await entitled(ana), true);
    await requestChange(ana, talentA);
    const { rows: [{ s }] } = await as(db, ana, "select public.my_subscription() as s");
    assert.deepEqual({ required: s.required, entitled: s.entitled, subscription: s.subscription }, { required: false, entitled: true, subscription: null });
    assert.equal((await as(db, users.owner, "select public.my_subscription() as s")).rows[0].s, null, "staff are not talent");
    assert.equal(await entitled(users.owner), false);
  });

  test("only billing managers can require subscriptions; talent cannot", async () => {
    await rowsAs(db, ana, "update public.billing_settings set require_subscription = true");
    assert.equal((await su("select require_subscription from public.billing_settings"))[0].require_subscription, false);
    await as(db, users.owner, "update public.billing_settings set require_subscription = true");
    assert.equal((await su("select require_subscription from public.billing_settings"))[0].require_subscription, true);
  });

  test("once required, a talent without a subscription is locked out of portal writes", async () => {
    assert.equal(await entitled(ana), false);
    assert.ok(await rejects(db, ana, `insert into public.talent_change_requests (talent_id, field_group, changes) values ('${talentA}', 'contact', '{"mobile":"1"}')`));
    assert.ok(await rejects(db, ana, `insert into public.talent_availability (talent_id, start_on, end_on, kind) values ('${talentA}', current_date, current_date, 'unavailable')`));
    assert.ok(await rejects(db, ana, `insert into storage.objects (bucket_id, name) values ('talent-private', 'talent/${talentA}/portal/x.jpg')`));
    // Reads still work, so the talent can see their profile and the subscribe page.
    assert.equal((await rowsAs(db, ana, "select id from public.talent")).length, 1);
    assert.equal((await rowsAs(db, ana, "select key from public.subscription_plans where active")).length, 1);
  });

  test("a talent can never grant themselves access", async () => {
    assert.ok(await rejects(db, ana, `insert into public.talent_subscriptions (talent_id, plan_key, status) values ('${talentA}', 'pro', 'active')`));
    assert.ok(await rejects(db, ana, `insert into public.billing_events (provider, event_id, type) values ('stripe', 'evt_1', 'x')`));
    assert.equal(await entitled(ana), false);
  });

  test("staff grant complimentary access; it unlocks only that talent", async () => {
    await as(db, users.owner, `insert into public.talent_subscriptions (talent_id, plan_key, status, note) values ('${talentA}', 'pro', 'active', 'Comp')`);
    assert.equal(await entitled(ana), true);
    assert.equal(await entitled(ben), false);
    // The same writes refused above now succeed: the rule, not a broken query, refused them.
    await requestChange(ana, talentA);
    await as(db, ana, `insert into public.talent_availability (talent_id, start_on, end_on, kind) values ('${talentA}', current_date, current_date, 'unavailable')`);
    await as(db, ana, `insert into storage.objects (bucket_id, name) values ('talent-private', 'talent/${talentA}/portal/x.jpg')`);
    assert.deepEqual(await rowsAs(db, ben, "select talent_id from public.talent_subscriptions"), [], "talent see only their own subscription");
    assert.equal((await rowsAs(db, ana, "select status from public.talent_subscriptions"))[0].status, "active");
    const audit = await su("select action from public.audit_logs where entity_id = $1 and action like 'subscription.%'", [talentA]);
    assert.ok(audit.length >= 1, "granting access is audited");
    // Staff cannot fake a payment-provider subscription.
    assert.ok(await rejects(db, users.owner, `insert into public.talent_subscriptions (talent_id, plan_key, status, provider) values ('${talentB}', 'pro', 'active', 'stripe')`));
  });

  test("access ends with the subscription: expired comp, canceled, past-due grace", async () => {
    await su("update public.talent_subscriptions set current_period_end = now() - interval '1 day' where talent_id = $1", [talentA]);
    assert.equal(await entitled(ana), false, "complimentary access ends at its end date");
    await su("update public.talent_subscriptions set provider = 'stripe', status = 'past_due', current_period_end = now() - interval '2 days' where talent_id = $1", [talentA]);
    assert.equal(await entitled(ana), true, "past due keeps access during the grace period");
    await su("update public.talent_subscriptions set current_period_end = now() - interval '30 days' where talent_id = $1", [talentA]);
    assert.equal(await entitled(ana), false);
    await su("update public.talent_subscriptions set status = 'canceled', current_period_end = now() + interval '30 days' where talent_id = $1", [talentA]);
    assert.equal(await entitled(ana), false);
  });

  test("staff work is never blocked by subscriptions", async () => {
    await as(db, users.owner, `insert into public.talent_availability (talent_id, start_on, end_on, kind) values ('${talentB}', current_date, current_date, 'unavailable')`);
  });
});
