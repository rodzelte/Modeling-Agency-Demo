// Phase 13: companies, bookings, money, tasks, conflicts. Run: npm run test:rls
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { addMember, as, createDatabase, newUser, rejects, rowsAs, users } from "./harness.mjs";

let db;
const su = async (sql, params) => (await db.query(sql, params)).rows;
const people = {};
let talentA;
let talentB;
let companyId;
let bookingId;

before(async () => {
  db = await createDatabase();
  talentA = (await su("insert into public.talent (slug, first_name, last_name, display_name) values ('op-a', 'A', 'A', 'A') returning id"))[0].id;
  talentB = (await su("insert into public.talent (slug, first_name, last_name, display_name) values ('op-b', 'B', 'B', 'B') returning id"))[0].id;
  people.booker = await addMember(db, newUser("booker"), "booker");
  people.staff = await addMember(db, newUser("staff"), "staff");
  people.talentA = await addMember(db, newUser("talent-a"), "talent", talentA);
  people.talentB = await addMember(db, newUser("talent-b"), "talent", talentB);
});

describe("phase 13: companies and bookings", () => {
  test("bookers create companies, contacts and bookings with a reference", async () => {
    companyId = (await as(db, people.booker, "insert into public.companies (name, kind) values ('Acme Swimwear', 'brand') returning id")).rows[0].id;
    await as(db, people.booker, `insert into public.company_contacts (company_id, name, email) values ('${companyId}', 'Casey Client', 'casey@example.test')`);
    const { rows: [booking] } = await as(db, people.booker, `insert into public.bookings (title, company_id, start_at, end_at, status)
      values ('Summer campaign', '${companyId}', '2026-10-05 09:00+00', '2026-10-05 17:00+00', 'option') returning id, reference`);
    bookingId = booking.id;
    assert.match(booking.reference, /^BK-\d{5}$/);
    await as(db, people.booker, `insert into public.booking_talent (booking_id, talent_id) values ('${bookingId}', '${talentA}')`);
    assert.equal((await su("select 1 from public.audit_logs where action = 'booking.created' and entity_id = $1", [bookingId])).length, 1);
  });

  test("read-only staff see the schedule but cannot change it", async () => {
    assert.equal((await rowsAs(db, people.staff, "select id from public.bookings")).length, 1);
    assert.ok(await rejects(db, people.staff, "insert into public.companies (name) values ('X')"));
    await rowsAs(db, people.staff, `update public.bookings set status = 'cancelled' where id = '${bookingId}'`);
    assert.equal((await su("select status from public.bookings where id = $1", [bookingId]))[0].status, "option");
  });

  test("creative and anonymous callers see nothing", async () => {
    assert.deepEqual(await rowsAs(db, users.creative, "select id from public.bookings"), []);
    assert.deepEqual(await rowsAs(db, users.creative, "select id from public.companies"), []);
    assert.deepEqual(await rowsAs(db, "anon", "select id from public.bookings"), []);
  });

  test("status changes are audited", async () => {
    await as(db, people.booker, `update public.bookings set status = 'confirmed' where id = '${bookingId}'`);
    const [row] = await su("select before_data, after_data from public.audit_logs where action = 'booking.status_changed' and entity_id = $1", [bookingId]);
    assert.equal(row.before_data.status, "option");
    assert.equal(row.after_data.status, "confirmed");
  });

  test("end cannot be before start", async () => {
    assert.ok(await rejects(db, people.booker, "insert into public.bookings (title, start_at, end_at) values ('Bad', '2026-10-05 10:00+00', '2026-10-05 09:00+00')"));
  });
});

describe("phase 13: money is separate", () => {
  test("finance roles read and write fees; staff cannot see them", async () => {
    await as(db, people.booker, `insert into public.booking_financials (booking_id, rate_type, fee_total, commission_pct) values ('${bookingId}', 'day', 2500, 20)`);
    await as(db, people.booker, `insert into public.booking_talent_fees (booking_id, talent_id, fee) values ('${bookingId}', '${talentA}', 2000)`);
    assert.equal((await rowsAs(db, users.accounting, "select fee_total from public.booking_financials"))[0].fee_total, "2500.00");
    assert.deepEqual(await rowsAs(db, people.staff, "select fee_total from public.booking_financials"), []);
    assert.deepEqual(await rowsAs(db, people.staff, "select fee from public.booking_talent_fees"), []);
  });

  test("fee changes are audited without amounts", async () => {
    const rows = await su("select metadata from public.audit_logs where action = 'booking.financials_changed' and entity_id = $1", [bookingId]);
    assert.ok(rows.length >= 2);
    assert.ok(rows.every((row) => !JSON.stringify(row.metadata).includes("2500")));
  });
});

describe("phase 13: talent logins", () => {
  test("talent see their own confirmed bookings only, never fees", async () => {
    assert.equal((await rowsAs(db, people.talentA, "select id from public.bookings")).length, 1);
    assert.deepEqual(await rowsAs(db, people.talentB, "select id from public.bookings"), []);
    assert.deepEqual(await rowsAs(db, people.talentA, "select fee from public.booking_talent_fees"), []);
    assert.deepEqual(await rowsAs(db, people.talentA, "select id from public.companies"), []);
  });

  test("options are not visible to talent", async () => {
    const { rows: [option] } = await as(db, people.booker, "insert into public.bookings (title, start_at, end_at) values ('Maybe', '2026-11-01 09:00+00', '2026-11-01 10:00+00') returning id");
    await as(db, people.booker, `insert into public.booking_talent (booking_id, talent_id) values ('${option.id}', '${talentA}')`);
    assert.equal((await rowsAs(db, people.talentA, "select id from public.bookings")).length, 1);
  });
});

describe("phase 13: conflicts and tasks", () => {
  test("overlapping bookings and appointments are reported", async () => {
    await su("insert into public.talent_appointments (talent_id, event_type, start_at, end_at) values ($1, 'Fitting', '2026-10-05 16:00+00', '2026-10-05 18:00+00')", [talentA]);
    const rows = (await as(db, people.booker, `select kind, label from public.talent_booking_conflicts(array['${talentA}', '${talentB}']::uuid[], '2026-10-05 12:00+00', '2026-10-05 19:00+00')`)).rows;
    assert.deepEqual(rows.map((row) => row.kind).sort(), ["appointment", "booking"]);
    const excluded = (await as(db, people.booker, `select kind from public.talent_booking_conflicts(array['${talentA}']::uuid[], '2026-10-05 12:00+00', '2026-10-05 19:00+00', '${bookingId}')`)).rows;
    assert.deepEqual(excluded.map((row) => row.kind), ["appointment"]);
  });

  test("members manage their own tasks; managers see all", async () => {
    await as(db, users.creative, `insert into public.tasks (title, assignee_id) values ('Retouch selects', '${users.creative.id}')`);
    assert.ok(await rejects(db, users.creative, `insert into public.tasks (title, assignee_id) values ('For someone else', '${people.booker.id}')`));
    await as(db, people.booker, `insert into public.tasks (title, assignee_id, related_type, related_id) values ('Send call sheet', '${people.staff.id}', 'booking', '${bookingId}')`);
    assert.equal((await rowsAs(db, users.creative, "select title from public.tasks")).length, 1);
    assert.equal((await rowsAs(db, people.booker, "select title from public.tasks")).length, 2);
    await as(db, people.staff, "update public.tasks set status = 'done' where title = 'Send call sheet'");
    const [task] = await su("select status, completed_at from public.tasks where title = 'Send call sheet'");
    assert.equal(task.status, "done");
    assert.ok(task.completed_at);
    assert.ok(await rejects(db, people.staff, `update public.tasks set assignee_id = '${users.owner.id}' where title = 'Send call sheet'`));
  });
});
