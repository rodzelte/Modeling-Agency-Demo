-- Development-only seed: fictional identities, never real people. Never run on production.
-- Role, permission and board rows come from the migrations. Auth users are created
-- through Supabase Auth; the allowlist rows below bind to them once each confirms
-- their email (password sign-up or magic link in a local stack).
-- Tests replay this file after the migrations (tests/rls/seed.test.mjs).

insert into public.agency_members (email, full_name, role, status) values
  ('owner@example.test', 'Test Owner', 'owner', 'active'),
  ('admin@example.test', 'Test Administrator', 'administrator', 'active'),
  ('manager@example.test', 'Test Talent Manager', 'talent_manager', 'active'),
  ('booker@example.test', 'Test Booker', 'booker', 'active'),
  ('creative@example.test', 'Test Creative', 'creative', 'active'),
  ('accounting@example.test', 'Test Accounting', 'accounting', 'active'),
  ('readonly@example.test', 'Test Read Only', 'read_only', 'active')
on conflict ((lower(email))) do nothing;

insert into public.talent (id, slug, first_name, last_name, display_name, location, gender, publication_status, show_on_website, show_in_search, show_age, is_minor, guardian_required, consent_status, public_bio)
values
  ('a0000000-0000-4000-8000-000000000001', 'avery-stone', 'Avery', 'Stone', 'Avery', 'Dallas, TX', 'Female', 'published', true, true, false, false, false, 'not_required', 'Fictional editorial and runway model used for development.'),
  ('a0000000-0000-4000-8000-000000000002', 'jordan-vale', 'Jordan', 'Vale', 'Jordan', 'Fort Worth, TX', 'Male', 'published', true, true, true, false, false, 'not_required', 'Fictional commercial talent used for development.'),
  ('a0000000-0000-4000-8000-000000000003', 'sam-rivers', 'Sam', 'Rivers', 'Sam', 'Dallas, TX', 'Male', 'published', true, true, false, true, true, 'granted', 'Fictional teen talent used to test minor protections.'),
  ('a0000000-0000-4000-8000-000000000004', 'casey-draft', 'Casey', 'North', 'Casey', 'Austin, TX', 'Female', 'draft', false, false, false, false, false, 'not_required', null)
on conflict (id) do nothing;

insert into public.talent_private_details (talent_id, date_of_birth, mobile, email)
values
  ('a0000000-0000-4000-8000-000000000001', '1999-05-14', '555-0101', 'avery@example.test'),
  ('a0000000-0000-4000-8000-000000000002', '1995-11-02', '555-0102', 'jordan@example.test'),
  ('a0000000-0000-4000-8000-000000000003', '2011-03-20', '555-0103', 'guardian.sam@example.test'),
  ('a0000000-0000-4000-8000-000000000004', '2001-08-30', '555-0104', 'casey@example.test')
on conflict (talent_id) do nothing;

insert into public.talent_measurements (talent_id, height_cm, bust_chest_cm, waist_cm, hips_cm, shoe_size_us, hair_color, eye_color)
values
  ('a0000000-0000-4000-8000-000000000001', 178, 84, 61, 89, 9, 'Brown', 'Green'),
  ('a0000000-0000-4000-8000-000000000002', 188, 97, 79, 94, 11, 'Black', 'Brown'),
  ('a0000000-0000-4000-8000-000000000003', 170, 86, 70, 84, 9.5, 'Blonde', 'Blue');

-- Board assignments by slug, so the seed follows whatever boards the migrations created.
insert into public.talent_board_assignments (talent_id, board_id)
select t.id, b.id
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'fashion-women'),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'fashion-men'),
  ('a0000000-0000-4000-8000-000000000003'::uuid, 'teens-boys')
) as t(id, slug)
join public.boards b on b.slug = t.slug
on conflict do nothing;
