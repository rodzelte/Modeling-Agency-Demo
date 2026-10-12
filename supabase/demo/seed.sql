-- Demo sandbox seed: fictional identities only, never real people. This file is
-- loaded ONLY into the in-memory demo sandbox (src/demo); it is not a migration
-- and must never be run against a Supabase project.
--
-- The Auth users for the demo sign-in accounts are created first by
-- src/demo/seed/index.ts (ids d0000000-0000-4000-8000-00000000000N); the
-- agency_members rows below bind to them.
--
-- Conventions
--   * Every date is relative to now(), in the agency's time zone (America/Chicago),
--     so the workspace never goes stale.
--   * Main records have fixed, readable ids: prefix + sequence number, e.g. talent
--     a0000000-0000-4000-8000-000000000001 (see demo_seed.id below).
--       a0 talent        a1 applications   a5 portfolios   a6 digital books
--       b0 bookings      c0 companies      c1 company contacts   c5 packages
--       c7 change requests   c9 talent contacts   dc documents   e0 boards   e5 tasks
--       ee website pages     f0NN photos of talent NN
--       d1 portal sign-ins of four other talent (Auth users added in section 16,
--          confirmed but without a password, so only Amara Cole can be signed in as)
--     GHL and CDS rows use text ids: demoContact0001, demoPipeRecruitment01, 48102 …
--   * The seed signs each section as the teammate who would have done the work
--     (request.jwt.claims), so the database triggers stamp created_by / updated_by
--     and the audit log shows several people. Sections the server writes in
--     production (GHL sync, incoming applications) run with no user.
--   * Names, companies, addresses, phone numbers (555-01xx), emails (.example) and
--     account numbers are all invented.

-- ===========================================================================
-- 0. Helpers (dropped again at the end of this file)
-- ===========================================================================
create schema demo_seed;

-- prefix 'a0', n 7  ->  a0000000-0000-4000-8000-000000000007
create function demo_seed.id(prefix text, n integer) returns uuid language sql immutable as $$
  select (prefix || '000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function demo_seed.t(n integer) returns uuid language sql immutable as $$
  select demo_seed.id('a0', n)
$$;
-- Photo n of talent number t: f0TT0000-0000-4000-8000-0000000000NN
create function demo_seed.photo(t integer, n integer) returns uuid language sql immutable as $$
  select ('f0' || lpad(t::text, 2, '0') || '0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function demo_seed.today() returns date language sql stable as $$
  select (now() at time zone 'America/Chicago')::date
$$;
-- A wall-clock time in Dallas, `days` from today (negative = past).
create function demo_seed.at(days integer, clock text) returns timestamptz language sql stable as $$
  select ((demo_seed.today() + days) + clock::time) at time zone 'America/Chicago'
$$;
create function demo_seed.ago(days numeric) returns timestamptz language sql stable as $$
  select now() - days * interval '1 day'
$$;
-- Date of birth of someone who is `years` old and had a birthday `days` ago.
create function demo_seed.born(years integer, days integer) returns date language sql stable as $$
  select (demo_seed.today() - make_interval(years => years, days => days))::date
$$;
-- Date of birth of someone who turns `turning` in `in_days` days.
create function demo_seed.born_soon(turning integer, in_days integer) returns date language sql stable as $$
  select ((demo_seed.today() + in_days) - make_interval(years => turning))::date
$$;
-- Centimetres as a US CRM stores them: 178 -> 5'10" and 82 -> 32.5 (inches).
create function demo_seed.feet(cm numeric) returns text language sql immutable as $$
  select (round(cm / 2.54)::int / 12) || '''' || (round(cm / 2.54)::int % 12) || '"'
$$;
create function demo_seed.inches(cm numeric) returns text language sql immutable as $$
  select rtrim(rtrim((round(cm / 2.54 * 2) / 2)::numeric(5, 1)::text, '0'), '.')
$$;
create function demo_seed.board(board_slug text) returns uuid language sql stable as $$
  select id from public.boards where slug = board_slug
$$;
-- Sign the following statements as a demo teammate; 'system' = no user (server writes).
create function demo_seed.act_as(who text) returns text language sql as $$
  select set_config('request.jwt.claims', coalesce((
    select json_build_object('sub', u.id, 'role', 'authenticated', 'email', u.email)::text
    from auth.users u
    where u.id = demo_seed.id('d0', case who
      when 'olivia' then 1 when 'marcus' then 2 when 'priya' then 3 when 'daniel' then 4
      when 'sofia' then 5 when 'henry' then 6 when 'grace' then 7 when 'amara' then 8 end)), ''), false)
$$;

-- ===========================================================================
-- 1. Team
-- ===========================================================================
select demo_seed.act_as('olivia');

insert into public.agency_members (email, full_name, role, status) values
  ('olivia.hart@northlight-demo.example', 'Olivia Hart', 'owner', 'active'),
  ('marcus.bell@northlight-demo.example', 'Marcus Bell', 'administrator', 'active'),
  ('priya.nair@northlight-demo.example', 'Priya Nair', 'booker', 'active'),
  ('daniel.okafor@northlight-demo.example', 'Daniel Okafor', 'talent_manager', 'active'),
  ('sofia.marin@northlight-demo.example', 'Sofia Marin', 'creative', 'active'),
  ('henry.cole@northlight-demo.example', 'Henry Cole', 'accounting', 'active'),
  ('grace.lindqvist@northlight-demo.example', 'Grace Lindqvist', 'read_only', 'active');

-- ===========================================================================
-- 2. Boards (the migrations create Women, Men, Teens and six sub-boards)
-- ===========================================================================
select demo_seed.act_as('daniel');

update public.boards b set description = v.description, website_section = v.website_section
from (values
  ('women', 'Editorial, runway, commercial and curve talent based across Texas.', 'main'),
  ('fashion-women', 'Our main women''s board: editorial, runway and campaign faces.', 'main'),
  ('development-women', 'New signings building their books with test shoots and first bookings.', 'development'),
  ('curve-women', 'Curve talent for fashion, swim, lingerie and lifestyle clients.', 'main'),
  ('men', 'Fashion, commercial and development men for campaigns, e-commerce and runway.', 'main'),
  ('fashion-men', 'Our main men''s board: tailoring, denim, sportswear and editorial.', 'main'),
  ('development-men', 'New faces in their first year with the agency.', 'development'),
  ('teens', 'Represented with a parent or guardian on every booking.', 'teens'),
  ('teens-boys', 'Teen boys, 13 to 17, for catalog, commercial and lifestyle work.', 'teens')
) as v(slug, description, website_section)
where b.slug = v.slug;

insert into public.boards (id, category, section, name, slug, path_segment, parent_board_id, is_minor_board, display_order, sort_order,
  is_active, publish_to_website, internal_only, show_in_navigation, description, website_section) values
  (demo_seed.id('e0', 1), 'teens', 'girls', 'Teens / Girls', 'teens-girls', 'girls', demo_seed.board('teens'), true, 7, 7,
    true, true, false, true, 'Teen girls, 13 to 17, for catalog, commercial and lifestyle work.', 'teens'),
  (demo_seed.id('e0', 2), 'women', 'commercial', 'Women / Commercial', 'commercial-women', 'commercial', demo_seed.board('women'), false, 8, 8,
    true, true, false, true, 'Real, relatable faces for lifestyle, healthcare, retail and broadcast clients.', 'main'),
  (demo_seed.id('e0', 3), 'men', 'commercial', 'Men / Commercial', 'commercial-men', 'commercial', demo_seed.board('men'), false, 9, 9,
    true, true, false, true, 'Lifestyle and commercial men for retail, automotive, finance and broadcast.', 'main'),
  (demo_seed.id('e0', 4), 'general', 'main', 'New Faces (internal)', 'new-faces-internal', 'new-faces-internal', null, false, 20, 20,
    true, false, true, false, 'Signed or in onboarding, not yet shown to clients. Staff only.', null),
  (demo_seed.id('e0', 5), 'general', 'main', 'Direct Bookings (internal)', 'direct-bookings-internal', 'direct-bookings-internal', null, false, 21, 21,
    true, false, true, false, 'Talent we book for returning clients without showing them on the website.', null);

-- ===========================================================================
-- 3. Reference data: skills and partner agencies
-- ===========================================================================
insert into public.skill_categories (name, sort_order) values ('Modeling', 0), ('Other', 20);

insert into public.skills (category_id, name, sort_order)
select c.id, v.name, v.sort_order
from (values
  ('Modeling', 'Editorial', 1), ('Modeling', 'Commercial print', 2), ('Modeling', 'E-commerce', 3), ('Modeling', 'Fit modeling', 4),
  ('Modeling', 'Swim', 5), ('Modeling', 'Hand and parts', 6),
  ('Runway', 'High fashion runway', 1), ('Runway', 'Bridal runway', 2), ('Runway', 'Showroom', 3),
  ('Acting', 'On-camera commercial', 1), ('Acting', 'Improv', 2), ('Acting', 'Voice-over', 3),
  ('Dance', 'Ballet', 1), ('Dance', 'Contemporary', 2), ('Dance', 'Hip-hop', 3), ('Dance', 'Ballroom', 4),
  ('Singing', 'Alto', 1), ('Singing', 'Tenor', 2),
  ('Sports', 'Distance running', 1), ('Sports', 'Soccer', 2), ('Sports', 'Basketball', 3), ('Sports', 'Tennis', 4),
  ('Sports', 'Yoga', 5), ('Sports', 'Horseback riding', 6), ('Sports', 'Skateboarding', 7),
  ('Swimming', 'Competitive swimming', 1), ('Swimming', 'Open-water certified', 2),
  ('Martial Arts', 'Taekwondo', 1), ('Martial Arts', 'Boxing', 2),
  ('Languages', 'Spanish', 1), ('Languages', 'French', 2), ('Languages', 'Arabic', 3), ('Languages', 'Japanese', 4),
  ('Languages', 'Portuguese', 5), ('Languages', 'Hindi', 6), ('Languages', 'German', 7), ('Languages', 'Korean', 8),
  ('Musical Instruments', 'Piano', 1), ('Musical Instruments', 'Guitar', 2), ('Musical Instruments', 'Violin', 3),
  ('Other', 'Valid driver license', 1), ('Other', 'Motorcycle license', 2), ('Other', 'Comfortable with animals', 3)
) as v(category, name, sort_order)
join public.skill_categories c on c.name = v.category;

insert into public.agencies (name, country, city, phone, email, website, notes) values
  ('Kestrel Model Management', 'United States', 'New York', '(212) 555-0161', 'placements@kestrel-models.example', 'https://kestrel-models.example', 'New York partner for main-board women and men. Placement contact: Ingrid Solberg.'),
  ('Southwind Talent', 'United States', 'Los Angeles', '(323) 555-0162', 'newfaces@southwind-talent.example', 'https://southwind-talent.example', 'Commercial and lifestyle; strong on-camera division.'),
  ('Harbourline Models', 'United Kingdom', 'London', null, 'bookings@harbourline.example', 'https://harbourline.example', 'UK placements, usually for the spring show season. Reach them by email.'),
  ('Atelier Nord Models', 'France', 'Paris', null, 'contact@ateliernord.example', 'https://ateliernord.example', 'Paris showroom season and editorial. Reach them by email.'),
  ('Vela Milano', 'Italy', 'Milan', null, 'info@velamilano.example', 'https://velamilano.example', null),
  ('Juniper Kids & Teens', 'United States', 'Austin', '(512) 555-0166', 'hello@juniper-kids.example', 'https://juniper-kids.example', 'Mother agency for several of our teen talent.');

-- ===========================================================================
-- 4. Talent
-- ===========================================================================
-- Everyone starts as a draft, exactly as in the app; section 8 publishes them once
-- their boards and photos are in place.
insert into public.talent (id, talent_id, slug, first_name, last_name, display_name, location, gender, date_joined, status,
  is_minor, guardian_required, consent_status, show_age, show_measurements, show_resume, show_comp_card, crm_status, crm_programs, created_at, public_bio)
select demo_seed.t(v.n), 'T-42A' || lpad(v.n::text, 3, '0'), v.slug, v.first_name, v.last_name, v.first_name || ' ' || v.last_name, v.location, v.gender,
  demo_seed.today() - v.joined_days, v.status, v.is_minor, v.is_minor, v.consent, v.show_age, not v.is_minor, v.n <= 8, v.n <= 8,
  v.crm_status, v.crm_programs::text[], demo_seed.ago(v.joined_days), v.bio
from (values
  (1, 'amara-cole', 'Amara', 'Cole', 'Dallas, TX', 'Female', 1280, 'active', false, 'not_required', true, 'active', '{Talent Recruitment}',
    'Dallas-born and scouted at an open call, Amara moves easily between editorial and campaign work. Clients book her for her calm presence on set and the precision she brings to movement, a holdover from twelve years of ballet.'),
  (2, 'julian-reyes', 'Julian', 'Reyes', 'Austin, TX', 'Male', 1105, 'active', false, 'not_required', true, 'active', '{Talent Recruitment}',
    'Julian splits his time between Austin and New York. A former collegiate distance runner, he is a natural for sportswear and denim, and has become a regular for tailoring clients who want an athletic frame.'),
  (3, 'sienna-brooks', 'Sienna', 'Brooks', 'Fort Worth, TX', 'Female', 890, 'active', false, 'not_required', false, 'booked', '{Model Expo,Talent Recruitment}',
    'Sienna joined after our Model Expo and has not slowed down since. Runway is her first love: she has walked every bridal market season in Dallas for three years and brings the same poise to lookbooks and showroom work.'),
  (4, 'mateo-alvarez', 'Mateo', 'Alvarez', 'Houston, TX', 'Male', 760, 'active', false, 'not_required', false, null, '{}',
    'Originally from Monterrey and now based in Houston, Mateo works across fashion and commercial. Bilingual in Spanish and English, he is as comfortable delivering lines on a broadcast set as he is on a denim campaign.'),
  (5, 'noor-haddad', 'Noor', 'Haddad', 'Dallas, TX', 'Female', 540, 'active', false, 'not_required', false, 'active', '{Talent Recruitment}',
    'Noor is finishing an architecture degree while building a book that leans editorial. Photographers love her strong profile and her patience for long, technical beauty shoots.'),
  (6, 'elise-fontaine', 'Elise', 'Fontaine', 'Plano, TX', 'Female', 980, 'active', false, 'not_required', false, null, '{}',
    'Elise is one of the most requested curve models in Texas, booked for swim, lingerie and lifestyle campaigns. She is also a certified yoga instructor and a confident on-camera host.'),
  (7, 'kai-nakamura', 'Kai', 'Nakamura', 'Dallas, TX', 'Male', 310, 'active', false, 'not_required', false, 'graduated', '{Model Expo}',
    'Kai was signed straight out of Model Expo and is in his first full year. A skateboarder with an easy, unposed energy, he is already a favorite for streetwear and youth-focused brands.'),
  (8, 'zoe-whitfield', 'Zoe', 'Whitfield', 'Frisco, TX', 'Female', 420, 'active', true, 'granted', false, 'graduated', '{Model Expo}',
    'Zoe is a bright, expressive teen who loves being on set. She plays competitive soccer and is a natural in lifestyle and back-to-school campaigns.'),
  (9, 'ethan-park', 'Ethan', 'Park', 'Arlington, TX', 'Male', 365, 'active', true, 'granted', false, null, '{}',
    'Ethan is relaxed and funny in front of the camera. He swims competitively, plays guitar, and has worked on catalog and commercial sets across Dallas-Fort Worth.'),
  (10, 'lucas-bennett', 'Lucas', 'Bennett', 'McKinney, TX', 'Male', 250, 'active', true, 'granted', false, null, '{}',
    'Lucas is a high-school basketball player with a quick smile, booked for sportswear, retail and family lifestyle work.'),
  (11, 'imani-okoye', 'Imani', 'Okoye', 'Houston, TX', 'Female', 670, 'active', false, 'not_required', false, 'active', '{Talent Recruitment}',
    'Imani brings a dancer''s control to every frame. Based in Houston, she travels to Dallas weekly for fashion and beauty clients and has a growing list of repeat campaign bookings.'),
  (12, 'grace-sullivan', 'Grace', 'Sullivan', 'Austin, TX', 'Female', 1500, 'active', false, 'not_required', true, null, '{}',
    'Grace is a warm, versatile commercial talent with a decade of experience in healthcare, retail and broadcast work. Directors book her for her reliability and natural delivery.'),
  (13, 'theo-lindgren', 'Theo', 'Lindgren', 'Dallas, TX', 'Male', 480, 'active', false, 'not_required', false, null, '{}',
    'Theo has the clean Scandinavian look that tailoring and outerwear clients ask for by name. He is a trained pianist and a calm, professional presence on long shoot days.'),
  (14, 'rafael-costa', 'Rafael', 'Costa', 'San Antonio, TX', 'Male', 1340, 'active', false, 'not_required', true, null, '{}',
    'Rafael is a seasoned commercial talent and voice-over artist, fluent in Portuguese, Spanish and English. He is regularly cast as the friendly professional: the banker, the doctor, the dad.'),
  (15, 'anika-rao', 'Anika', 'Rao', 'Irving, TX', 'Female', 200, 'active', false, 'not_required', false, 'active', '{Talent Recruitment}',
    'Anika is a new signing with a striking, modern look. She is building her book quickly through test shoots and has already confirmed her first e-commerce clients.'),
  (16, 'camille-durand', 'Camille', 'Durand', 'Dallas, TX', 'Female', 610, 'active', false, 'not_required', false, null, '{}',
    'Camille is a curve model and trained contemporary dancer. She brings energy and movement to activewear and swim, and is a regular on the Dallas runway circuit.'),
  (17, 'river-ashby', 'River', 'Ashby', 'Fort Worth, TX', 'Non-binary', 150, 'active', false, 'not_required', false, 'enrolled', '{Model Expo}',
    'River is an artist and new face whose androgynous look works across both development boards. They are available for editorial, streetwear and beauty.'),
  (18, 'hannah-weiss', 'Hannah', 'Weiss', 'Denton, TX', 'Female', 2100, 'active', false, 'not_required', true, null, '{}',
    'Hannah has been with the agency since the early days. A former elementary teacher, she is the commercial talent clients call when they need warmth, humor and a believable family moment.'),
  (19, 'leo-martins', 'Leo', 'Martins', 'Dallas, TX', 'Male', 830, 'active', false, 'not_required', false, null, '{}',
    'Leo works across commercial and fashion, with a strong fitness book. He boxes, runs trails, and is booked year-round by activewear and outdoor brands.'),
  (20, 'ava-lindholm', 'Ava', 'Lindholm', 'Southlake, TX', 'Female', 35, 'active', true, 'pending', false, null, '{}',
    'Ava is a new teen signing who loves horses and theater. Her first test shoot is complete and her profile is being reviewed before it goes live.'),
  (21, 'mila-novak', 'Mila', 'Novak', 'Dallas, TX', 'Female', 12, 'active', false, 'not_required', false, 'accepted', '{}', null),
  (22, 'jonah-fields', 'Jonah', 'Fields', 'Austin, TX', 'Male', 21, 'active', false, 'not_required', false, null, '{}', null),
  (23, 'tessa-monroe', 'Tessa', 'Monroe', 'Houston, TX', 'Female', 6, 'on_hold', false, 'not_required', false, 'enrolled', '{Model Expo}', null),
  (24, 'victor-hale', 'Victor', 'Hale', 'Dallas, TX', 'Male', 1900, 'former', false, 'not_required', false, null, '{}',
    'Victor worked with the agency for five years across fashion and commercial before moving into production full time.')
) as v(n, slug, first_name, last_name, location, gender, joined_days, status, is_minor, consent, show_age, crm_status, crm_programs, bio);

select public.write_audit('talent.created', 'talent', id, jsonb_build_object('slug', slug, 'boards', 1))
from public.talent order by created_at;

-- Private details: date of birth, contact, rates. Three birthdays fall in the next
-- three weeks (Kai, Sienna, Ethan).
insert into public.talent_private_details (talent_id, date_of_birth, birth_place, nationality, mobile, email, allow_sms, email_icalendar,
  talent_login_enabled, minimum_hourly_rate, minimum_day_rate, notes)
select demo_seed.t(v.n), v.dob, v.birth_place, v.nationality, v.mobile, v.email, true, v.n <= 8, v.portal, v.hourly, v.day_rate, v.notes
from (values
  (1, demo_seed.born(24, 137), 'Dallas, Texas', 'American', '(214) 555-0101', 'amara.cole@talent-demo.example', true, 250, 2500, 'Prefers call times confirmed by text the evening before. Vegetarian catering.'),
  (2, demo_seed.born(27, 212), 'San Antonio, Texas', 'American', '(512) 555-0102', 'julian.reyes@talent-demo.example', true, 225, 2200, 'In New York the second week of most months; check availability before optioning.'),
  (3, demo_seed.born_soon(23, 11), 'Fort Worth, Texas', 'American', '(817) 555-0103', 'sienna.brooks@talent-demo.example', true, 200, 2000, null),
  (4, demo_seed.born(29, 45), 'Monterrey, Mexico', 'Mexican', '(713) 555-0104', 'mateo.alvarez@talent-demo.example', false, 225, 2200, 'Work authorization is tied to his visa: check the expiry on the Legal tab before confirming multi-month usage.'),
  (5, demo_seed.born(21, 300), 'Amman, Jordan', 'American', '(469) 555-0105', 'noor.haddad@talent-demo.example', true, 175, 1800, 'Studio classes Tuesday and Thursday mornings during the semester.'),
  (6, demo_seed.born(28, 88), 'New Orleans, Louisiana', 'American', '(972) 555-0106', 'elise.fontaine@talent-demo.example', false, 225, 2400, null),
  (7, demo_seed.born_soon(21, 4), 'Honolulu, Hawaii', 'American', '(214) 555-0107', 'kai.nakamura@talent-demo.example', false, 150, 1500, null),
  (8, demo_seed.born(16, 150), 'Frisco, Texas', 'American', '(469) 555-0108', 'whitfield.family@talent-demo.example', false, 125, 1200, 'Minor: all communication goes through her mother, Laura Whitfield. School days end at 3:45 pm.'),
  (9, demo_seed.born_soon(16, 19), 'Arlington, Texas', 'American', '(817) 555-0109', 'park.family@talent-demo.example', false, 125, 1200, 'Minor: contact his father, David Park. Swim meets most Saturdays.'),
  (10, demo_seed.born(17, 60), 'McKinney, Texas', 'American', '(972) 555-0110', 'bennett.family@talent-demo.example', false, 125, 1200, 'Minor: contact his mother, Renee Bennett.'),
  (11, demo_seed.born(25, 190), 'Houston, Texas', 'American', '(713) 555-0111', 'imani.okoye@talent-demo.example', true, 200, 2000, 'Drives up from Houston: travel day and mileage are billed for Dallas bookings under four hours.'),
  (12, demo_seed.born(33, 20), 'Tulsa, Oklahoma', 'American', '(512) 555-0112', 'grace.sullivan@talent-demo.example', false, 175, 1600, null),
  (13, demo_seed.born(24, 250), 'Minneapolis, Minnesota', 'American', '(214) 555-0113', 'theo.lindgren@talent-demo.example', false, 175, 1800, null),
  (14, demo_seed.born(35, 310), 'Recife, Brazil', 'American', '(210) 555-0114', 'rafael.costa@talent-demo.example', false, 175, 1600, 'Voice-over reel on file. Union status: non-union.'),
  (15, demo_seed.born(19, 100), 'Irving, Texas', 'American', '(469) 555-0115', 'anika.rao@talent-demo.example', false, 125, 1200, null),
  (16, demo_seed.born(26, 170), 'Lafayette, Louisiana', 'American', '(214) 555-0116', 'camille.durand@talent-demo.example', false, 200, 2000, null),
  (17, demo_seed.born(22, 33), 'Fort Worth, Texas', 'American', '(817) 555-0117', 'river.ashby@talent-demo.example', false, 125, 1200, 'Pronouns: they/them. Please brief clients before the booking.'),
  (18, demo_seed.born(41, 222), 'Denton, Texas', 'American', '(940) 555-0118', 'hannah.weiss@talent-demo.example', false, 175, 1600, null),
  (19, demo_seed.born(31, 140), 'Dallas, Texas', 'American', '(214) 555-0119', 'leo.martins@talent-demo.example', false, 200, 1900, null),
  (20, demo_seed.born(14, 200), 'Southlake, Texas', 'American', '(817) 555-0120', 'lindholm.family@talent-demo.example', false, null, null, 'Minor: contact her mother, Kristin Lindholm. Guardian consent form sent, not yet returned.'),
  (21, demo_seed.born(20, 75), 'Dallas, Texas', 'American', '(214) 555-0121', 'mila.novak@talent-demo.example', false, null, null, 'Converted from a Join Us application. Test shoot to be scheduled.'),
  (22, demo_seed.born(23, 260), 'Austin, Texas', 'American', '(512) 555-0122', 'jonah.fields@talent-demo.example', false, null, null, null),
  (23, demo_seed.born(18, 290), 'Houston, Texas', 'American', '(713) 555-0123', 'tessa.monroe@talent-demo.example', false, null, null, 'Enrolled through Model Expo; onboarding call pending.'),
  (24, demo_seed.born(34, 50), 'Dallas, Texas', 'American', '(214) 555-0124', 'victor.hale@talent-demo.example', false, null, null, 'Left the agency on good terms. Do not book; refer inquiries to Daniel.')
) as v(n, dob, birth_place, nationality, mobile, email, portal, hourly, day_rate, notes);

-- Measurement snapshots (history is append-only; the latest official one is public).
select demo_seed.act_as('priya');
insert into public.talent_measurements (talent_id, measured_on, is_official, height_cm, bust_chest_cm, waist_cm, hips_cm, shoe_size_us,
  hair_color, eye_color, suit_size, inseam_cm, dress_size, hair_length, notes, created_at)
select demo_seed.t(v.n), demo_seed.today() - v.days_ago, v.official, v.height, v.bust, v.waist, v.hips, v.shoe, v.hair, v.eyes, v.suit, v.inseam,
  v.dress, v.hair_length, v.notes, demo_seed.ago(v.days_ago)
from (values
  (1, 410, true, 177, 82, 61, 88, '8.5', 'Dark brown', 'Brown', null, 82, '2', 'Long', 'Signing measurements.'),
  (1, 96, true, 178, 82, 61, 88.5, '8.5', 'Dark brown', 'Brown', null, 82, '2', 'Shoulder length', 'Re-measured for the fall show season.'),
  (2, 380, true, 188, 99, 79, 96, '11', 'Black', 'Hazel', '40L', 84, null, 'Short', null),
  (2, 60, true, 188, 100, 79, 96, '11', 'Black', 'Hazel', '40L', 84, null, 'Short', 'Chest up 1 cm after the marathon block.'),
  (3, 120, true, 179, 81, 60, 87, '9', 'Blonde', 'Blue', null, 84, '2', 'Long', null),
  (4, 150, true, 186, 98, 78, 95, '10.5', 'Dark brown', 'Brown', '40R', 82, null, 'Short', null),
  (5, 75, true, 176, 80, 60, 87, '8', 'Black', 'Dark brown', null, 81, '0', 'Long', null),
  (6, 110, true, 175, 102, 84, 112, '9.5', 'Auburn', 'Green', null, 80, '14', 'Long', null),
  (7, 300, true, 183, 93, 74, 91, '10', 'Black', 'Brown', '38R', 81, null, 'Medium', 'Signing measurements.'),
  (7, 40, true, 184.5, 94, 74, 92, '10.5', 'Black', 'Brown', '38L', 82, null, 'Medium', 'Still growing: re-measure every six months.'),
  (8, 400, true, 163, 78, 60, 84, '7', 'Light brown', 'Hazel', null, null, null, 'Long', null),
  (8, 55, true, 166, 80, 61, 86, '7.5', 'Light brown', 'Hazel', null, null, null, 'Long', 'Six-month teen check.'),
  (9, 350, true, 168, 82, 68, 84, '8.5', 'Black', 'Brown', null, 76, null, 'Short', null),
  (9, 30, true, 173, 85, 69, 86, '9.5', 'Black', 'Brown', null, 79, null, 'Short', 'Up 5 cm since signing.'),
  (10, 90, true, 180, 90, 72, 90, '11', 'Sandy blonde', 'Blue', '36R', 81, null, 'Short', null),
  (11, 130, true, 178, 83, 62, 90, '9', 'Black', 'Dark brown', null, 83, '4', 'Natural, medium', null),
  (12, 200, true, 170, 88, 69, 95, '8', 'Chestnut', 'Green', null, 78, '6', 'Shoulder length', null),
  (13, 140, true, 189, 97, 77, 94, '11.5', 'Blonde', 'Blue', '40L', 85, null, 'Short', null),
  (14, 260, true, 182, 104, 86, 100, '10', 'Black, greying', 'Brown', '42R', 80, null, 'Short', null),
  (15, 180, true, 174, 81, 61, 88, '7.5', 'Black', 'Dark brown', null, 80, '2', 'Long', 'Signing measurements.'),
  (16, 100, true, 173, 99, 81, 109, '9', 'Dark brown', 'Brown', null, 79, '12', 'Curly, long', null),
  (17, 145, true, 180, 86, 70, 90, '9.5', 'Bleached blonde', 'Grey', '36L', 82, null, 'Cropped', null),
  (18, 320, true, 168, 91, 73, 99, '8', 'Strawberry blonde', 'Blue', null, 77, '8', 'Bob', null),
  (19, 85, true, 185, 103, 81, 98, '11', 'Dark brown', 'Hazel', '42L', 82, null, 'Short', null),
  (20, 30, false, 160, 76, 59, 82, '6.5', 'Blonde', 'Blue', null, null, null, 'Long', 'Taken at the test shoot; official measurements once consent is on file.'),
  (22, 21, false, 187, 96, 78, 94, '11', 'Brown', 'Brown', '40L', 83, null, 'Short', 'Imported from the previous booking system.'),
  (24, 900, true, 187, 101, 82, 97, '11', 'Brown', 'Blue', '42L', 83, null, 'Short', null)
) as v(n, days_ago, official, height, bust, waist, hips, shoe, hair, eyes, suit, inseam, dress, hair_length, notes);

-- Current (not official) numbers for Amara, taken at a recent fitting.
insert into public.talent_measurements (talent_id, measured_on, is_official, height_cm, bust_chest_cm, waist_cm, hips_cm, shoe_size_us,
  hair_color, eye_color, inseam_cm, dress_size, hair_length, weight_kg, notes, created_at)
values (demo_seed.t(1), demo_seed.today() - 9, false, 178, 82.5, 61.5, 89, '8.5', 'Dark brown', 'Brown', 82, '2', 'Shoulder length', 58,
  'Taken at the Solene Atelier fitting. Not yet official.', demo_seed.ago(9));

-- The two measurements that came from other systems keep their source.
update public.talent_measurements set source = 'cds' where talent_id = demo_seed.t(22);

-- Board placement.
select demo_seed.act_as('daniel');
insert into public.talent_board_assignments (talent_id, board_id, board_order, sort_order, created_by, created_at)
select demo_seed.t(v.n), demo_seed.board(v.slug), v.position, v.position, demo_seed.id('d0', 4), t.created_at + interval '2 hours'
from (values
  (1, 'fashion-women', 1), (1, 'commercial-women', 3), (2, 'fashion-men', 1), (3, 'fashion-women', 2),
  (4, 'fashion-men', 2), (4, 'commercial-men', 2), (5, 'fashion-women', 3), (5, 'development-women', 4),
  (6, 'curve-women', 1), (7, 'development-men', 1), (8, 'teens-girls', 1), (9, 'teens-boys', 1), (10, 'teens-boys', 2),
  (11, 'fashion-women', 4), (12, 'commercial-women', 1), (13, 'fashion-men', 3), (14, 'commercial-men', 1),
  (15, 'development-women', 1), (16, 'curve-women', 2), (17, 'development-men', 2), (17, 'development-women', 2),
  (18, 'commercial-women', 2), (19, 'commercial-men', 3), (19, 'fashion-men', 4), (20, 'teens-girls', 2),
  (21, 'new-faces-internal', 1), (22, 'new-faces-internal', 2), (23, 'new-faces-internal', 3), (24, 'fashion-men', 9)
) as v(n, slug, position)
join public.talent t on t.id = demo_seed.t(v.n);

-- ===========================================================================
-- 5. Talent profile modules
-- ===========================================================================
-- Related contacts: guardians for every minor, emergency contacts, managers.
insert into public.talent_contacts (id, talent_id, name, relationship, email, phone, mobile, notes)
select demo_seed.id('c9', v.k), demo_seed.t(v.n), v.name, v.relationship, v.email, v.phone, v.mobile, v.notes
from (values
  (1, 1, 'Denise Cole', 'emergency', 'denise.cole@family-demo.example', null, '(214) 555-0125', 'Mother. Lives in Oak Cliff.'),
  (2, 2, 'Marisol Reyes', 'emergency', 'marisol.reyes@family-demo.example', null, '(512) 555-0126', 'Sister.'),
  (3, 2, 'Ingrid Solberg', 'agent', 'ingrid.solberg@kestrel-models.example', '(212) 555-0161', null, 'Placement agent at Kestrel Model Management, New York.'),
  (4, 3, 'Tom Brooks', 'emergency', 'tom.brooks@family-demo.example', null, '(817) 555-0127', 'Father.'),
  (5, 4, 'Lucia Alvarez', 'emergency', 'lucia.alvarez@family-demo.example', null, '(713) 555-0128', 'Wife.'),
  (6, 4, 'Paloma Ruiz', 'other', 'pruiz@ruiztate-law.example', '(713) 555-0129', null, 'Immigration attorney, Ruiz & Tate. Handles his visa renewals.'),
  (7, 5, 'Samir Haddad', 'emergency', 'samir.haddad@family-demo.example', null, '(469) 555-0130', 'Father.'),
  (8, 6, 'Corinne Abel', 'manager', 'corinne@abelmanagement.example', '(972) 555-0131', null, 'Personal manager: copy her on all campaign offers.'),
  (9, 7, 'Emi Nakamura', 'emergency', 'emi.nakamura@family-demo.example', null, '(214) 555-0132', 'Mother.'),
  (10, 8, 'Laura Whitfield', 'parent', 'laura.whitfield@family-demo.example', null, '(469) 555-0133', 'Mother and primary guardian. Attends every booking.'),
  (11, 8, 'Mark Whitfield', 'parent', 'mark.whitfield@family-demo.example', null, '(469) 555-0134', 'Father. Backup for pick-up.'),
  (12, 9, 'David Park', 'parent', 'david.park@family-demo.example', null, '(817) 555-0135', 'Father and primary guardian.'),
  (13, 9, 'Soo-jin Park', 'parent', 'soojin.park@family-demo.example', null, '(817) 555-0136', 'Mother.'),
  (14, 10, 'Renee Bennett', 'parent', 'renee.bennett@family-demo.example', null, '(972) 555-0137', 'Mother and primary guardian.'),
  (15, 20, 'Kristin Lindholm', 'guardian', 'kristin.lindholm@family-demo.example', null, '(817) 555-0138', 'Mother. Consent form sent for signature.'),
  (16, 11, 'Chidi Okoye', 'emergency', 'chidi.okoye@family-demo.example', null, '(713) 555-0139', 'Brother.')
) as v(k, n, name, relationship, email, phone, mobile, notes);

update public.talent t set guardian_contact_id = demo_seed.id('c9', v.k)
from (values (8, 10), (9, 12), (10, 14), (20, 15)) as v(n, k)
where t.id = demo_seed.t(v.n);

insert into public.talent_addresses (talent_id, label, contact_name, address_1, address_2, city, state, postal_code, country, mobile, is_main, is_billing, is_loan_out)
select demo_seed.t(v.n), v.label, v.contact_name, v.address_1, v.address_2, v.city, v.state, v.postal_code, 'United States', v.mobile, v.is_main, v.is_billing, v.is_loan_out
from (values
  (1, 'Home', null, '4127 Larkspur Lane', 'Apt 3B', 'Dallas', 'TX', '75206', '(214) 555-0101', true, true, false),
  (2, 'Home', null, '908 Cedar Hollow Drive', null, 'Austin', 'TX', '78704', '(512) 555-0102', true, true, false),
  (2, 'New York (seasonal)', 'c/o Kestrel Model Management', '212 Wexford Street', 'Floor 4', 'New York', 'NY', '10012', null, false, false, false),
  (3, 'Home', null, '615 Magnolia Bend Court', null, 'Fort Worth', 'TX', '76107', '(817) 555-0103', true, true, false),
  (4, 'Home', null, '2290 Bayou Crest Avenue', 'Unit 12', 'Houston', 'TX', '77006', '(713) 555-0104', true, true, false),
  (5, 'Home', null, '1804 Juniper Row', 'Apt 210', 'Dallas', 'TX', '75204', '(469) 555-0105', true, true, false),
  (6, 'Home', null, '7331 Willow Glen Trail', null, 'Plano', 'TX', '75024', '(972) 555-0106', true, false, false),
  (6, 'Loan-out company', 'Fontaine Creative LLC', '5000 Preston Meadow Parkway', 'Suite 140', 'Plano', 'TX', '75093', null, false, true, true),
  (7, 'Home', null, '3015 Sycamore Yard', 'Apt 6', 'Dallas', 'TX', '75226', '(214) 555-0107', true, true, false),
  (8, 'Home', 'Laura Whitfield', '11208 Bluestem Ridge Road', null, 'Frisco', 'TX', '75035', '(469) 555-0133', true, true, false),
  (9, 'Home', 'David Park', '4406 Heron Pond Lane', null, 'Arlington', 'TX', '76016', '(817) 555-0135', true, true, false),
  (10, 'Home', 'Renee Bennett', '2718 Foxtail Crossing', null, 'McKinney', 'TX', '75071', '(972) 555-0137', true, true, false),
  (11, 'Home', null, '1529 Alder Park Street', 'Apt 9C', 'Houston', 'TX', '77019', '(713) 555-0111', true, true, false),
  (12, 'Home', null, '6402 Quail Meadow Loop', null, 'Austin', 'TX', '78745', '(512) 555-0112', true, true, false),
  (13, 'Home', null, '830 Garnet Street', 'Apt 14', 'Dallas', 'TX', '75201', '(214) 555-0113', true, true, false),
  (14, 'Home', null, '9117 Mission Oak Drive', null, 'San Antonio', 'TX', '78230', '(210) 555-0114', true, true, false),
  (16, 'Home', null, '2255 Pecan Grove Avenue', 'Apt 5', 'Dallas', 'TX', '75219', '(214) 555-0116', true, true, false),
  (18, 'Home', null, '318 Sandpiper Court', null, 'Denton', 'TX', '76205', '(940) 555-0118', true, true, false),
  (19, 'Home', null, '4740 Ironbridge Road', 'Unit 301', 'Dallas', 'TX', '75235', '(214) 555-0119', true, true, false),
  (20, 'Home', 'Kristin Lindholm', '1905 Saddlebrook Way', null, 'Southlake', 'TX', '76092', '(817) 555-0138', true, false, false),
  (21, 'Home', null, '3300 Ashgrove Terrace', 'Apt 2', 'Dallas', 'TX', '75214', '(214) 555-0121', true, false, false)
) as v(n, label, contact_name, address_1, address_2, city, state, postal_code, mobile, is_main, is_billing, is_loan_out);

insert into public.talent_contact_methods (talent_id, kind, value, label, is_default, add_to_cc)
select demo_seed.t(v.n), v.kind, v.value, v.label, v.is_default, v.add_to_cc
from (values
  (1, 'mobile', '(214) 555-0101', 'Personal', true, false),
  (1, 'email', 'amara.cole@talent-demo.example', 'Personal', true, false),
  (1, 'email', 'amara.bookings@talent-demo.example', 'Call sheets', false, true),
  (2, 'mobile', '(512) 555-0102', 'Personal', true, false),
  (2, 'email', 'julian.reyes@talent-demo.example', 'Personal', true, false),
  (2, 'email', 'ingrid.solberg@kestrel-models.example', 'NY agent', false, true),
  (3, 'mobile', '(817) 555-0103', 'Personal', true, false),
  (3, 'email', 'sienna.brooks@talent-demo.example', 'Personal', true, false),
  (4, 'mobile', '(713) 555-0104', 'Personal', true, false),
  (4, 'email', 'mateo.alvarez@talent-demo.example', 'Personal', true, false),
  (4, 'phone', '(713) 555-0128', 'Home (Lucia)', false, false),
  (5, 'mobile', '(469) 555-0105', 'Personal', true, false),
  (5, 'email', 'noor.haddad@talent-demo.example', 'Personal', true, false),
  (6, 'mobile', '(972) 555-0106', 'Personal', true, false),
  (6, 'email', 'elise.fontaine@talent-demo.example', 'Personal', true, false),
  (6, 'email', 'corinne@abelmanagement.example', 'Manager', false, true),
  (7, 'mobile', '(214) 555-0107', 'Personal', true, false),
  (7, 'email', 'kai.nakamura@talent-demo.example', 'Personal', true, false),
  (8, 'mobile', '(469) 555-0133', 'Mother (Laura)', true, false),
  (8, 'email', 'laura.whitfield@family-demo.example', 'Mother (Laura)', true, true),
  (8, 'mobile', '(469) 555-0108', 'Zoe: emergencies only', false, false),
  (9, 'mobile', '(817) 555-0135', 'Father (David)', true, false),
  (9, 'email', 'david.park@family-demo.example', 'Father (David)', true, true),
  (10, 'mobile', '(972) 555-0137', 'Mother (Renee)', true, false),
  (10, 'email', 'renee.bennett@family-demo.example', 'Mother (Renee)', true, true),
  (11, 'mobile', '(713) 555-0111', 'Personal', true, false),
  (11, 'email', 'imani.okoye@talent-demo.example', 'Personal', true, false)
) as v(n, kind, value, label, is_default, add_to_cc);

insert into public.talent_rates (talent_id, rate_type, amount, currency, notes)
select demo_seed.t(v.n), v.rate_type, v.amount, 'USD', v.notes
from (values
  (1, 'Day rate (campaign)', 2500, 'Usage quoted separately.'), (1, 'Half day', 1500, null), (1, 'Editorial', 350, 'Flat, per story.'),
  (1, 'Runway show', 900, 'Per show, fittings billed hourly.'), (1, 'Fitting (hourly)', 85, 'Two-hour minimum.'),
  (2, 'Day rate (campaign)', 2200, null), (2, 'Half day', 1300, null), (2, 'E-commerce day', 1600, 'Up to 60 looks.'), (2, 'Editorial', 300, null),
  (3, 'Day rate (campaign)', 2000, null), (3, 'Runway show', 800, null), (3, 'Showroom (hourly)', 110, 'Three-hour minimum.'), (3, 'Fitting (hourly)', 75, null),
  (4, 'Day rate (campaign)', 2200, null), (4, 'Half day', 1300, null), (4, 'Broadcast session', 950, 'Plus usage per market.'),
  (5, 'Day rate (campaign)', 1800, null), (5, 'Half day', 1100, null), (5, 'Beauty day', 2000, 'Hair changes need approval first.'),
  (6, 'Day rate (campaign)', 2400, null), (6, 'Swim / lingerie day', 2800, 'Closed set required.'), (6, 'Half day', 1400, null),
  (7, 'Day rate', 1500, null), (7, 'Half day', 900, null), (7, 'Test shoot', 0, 'Development: trade for images.'),
  (8, 'Day rate (teen)', 1200, 'Guardian on set. Eight-hour maximum including school time.'), (8, 'Half day', 700, null),
  (9, 'Day rate (teen)', 1200, 'Guardian on set.'), (10, 'Day rate (teen)', 1200, 'Guardian on set.'),
  (11, 'Day rate (campaign)', 2000, null), (11, 'Half day', 1200, null), (11, 'Travel day', 400, 'Houston to Dallas.'),
  (12, 'Commercial session', 1600, null), (12, 'Half day', 900, null),
  (14, 'Commercial session', 1600, null), (14, 'Voice-over (hourly)', 300, 'One-hour minimum.'),
  (18, 'Commercial session', 1600, null), (19, 'Day rate', 1900, null), (19, 'Fitness day', 2100, null)
) as v(n, rate_type, amount, notes);

-- Social accounts (handles are invented; no links to real profiles).
insert into public.talent_social_accounts (talent_id, platform, handle, follower_count, updated_on)
select demo_seed.t(v.n), v.platform, v.handle, v.followers, demo_seed.today() - v.days_ago
from (values
  (1, 'Instagram', '@amara.cole.42', 48200, 12), (1, 'TikTok', '@amaracole.moves', 21700, 12),
  (2, 'Instagram', '@julianreyes.runs', 31500, 20), (2, 'YouTube', '@milesWithJulian', 4100, 45),
  (3, 'Instagram', '@sienna.brooks.tx', 26900, 9), (3, 'TikTok', '@siennaonset', 58300, 9),
  (4, 'Instagram', '@mateo.alvarez.mx', 19400, 30),
  (5, 'Instagram', '@noor.haddad.studio', 15800, 14),
  (6, 'Instagram', '@elise.fontaine.curve', 112000, 7), (6, 'TikTok', '@elisefontaine', 86500, 7), (6, 'YouTube', '@flowWithElise', 12900, 60),
  (7, 'Instagram', '@kai.nkmr', 9200, 5), (7, 'TikTok', '@kaiskates.dtx', 34100, 5),
  (8, 'Instagram', '@zoe.whitfield.model', 3100, 25),
  (9, 'Instagram', '@ethanpark.swims', 1800, 40),
  (11, 'Instagram', '@imani.okoye', 22400, 11), (11, 'TikTok', '@imanimoves', 15200, 11),
  (12, 'Instagram', '@grace.sullivan.atx', 6400, 70),
  (13, 'Instagram', '@theo.lindgren', 8700, 33),
  (14, 'Instagram', '@rafaelcosta.voice', 5200, 90),
  (15, 'Instagram', '@anika.rao.dfw', 4300, 6), (15, 'TikTok', '@anikarao', 11900, 6),
  (16, 'Instagram', '@camille.durand.moves', 37800, 15),
  (17, 'Instagram', '@river.ashby.art', 7600, 8),
  (18, 'Instagram', '@hannahweiss.tx', 2900, 120),
  (19, 'Instagram', '@leomartins.fit', 41300, 10), (19, 'YouTube', '@trailsWithLeo', 9800, 50),
  (21, 'Instagram', '@mila.novak.dallas', 2100, 12)
) as v(n, platform, handle, followers, days_ago);

-- Skills, linked to the catalogue. Public skills appear on the website profile.
insert into public.talent_skills (talent_id, category, skill, level, notes, is_public, category_id, skill_id)
select demo_seed.t(v.n), c.name, s.name, v.level, v.notes, v.is_public, c.id, s.id
from (values
  (1, 'Dance', 'Ballet', 'Advanced', 'Twelve years, pre-professional track.', true), (1, 'Modeling', 'Editorial', 'Professional', null, true),
  (1, 'Runway', 'High fashion runway', 'Professional', null, true), (1, 'Languages', 'French', 'Intermediate', null, true),
  (1, 'Sports', 'Yoga', 'Intermediate', null, false), (1, 'Other', 'Valid driver license', null, null, false),
  (2, 'Sports', 'Distance running', 'Professional', 'Former collegiate 10k runner.', true), (2, 'Languages', 'Spanish', 'Native', null, true),
  (2, 'Modeling', 'E-commerce', 'Professional', null, true), (2, 'Other', 'Motorcycle license', null, null, false),
  (3, 'Runway', 'Bridal runway', 'Professional', null, true), (3, 'Runway', 'Showroom', 'Professional', null, true),
  (3, 'Sports', 'Horseback riding', 'Advanced', 'Western and English.', true), (3, 'Dance', 'Ballroom', 'Intermediate', null, false),
  (4, 'Languages', 'Spanish', 'Native', null, true), (4, 'Acting', 'On-camera commercial', 'Professional', null, true),
  (4, 'Sports', 'Soccer', 'Advanced', null, true), (4, 'Musical Instruments', 'Guitar', 'Intermediate', null, false),
  (5, 'Languages', 'Arabic', 'Native', null, true), (5, 'Languages', 'French', 'Advanced', null, true), (5, 'Modeling', 'Editorial', 'Advanced', null, true),
  (6, 'Sports', 'Yoga', 'Professional', 'Certified instructor (200 hours).', true), (6, 'Modeling', 'Swim', 'Professional', null, true),
  (6, 'Acting', 'On-camera commercial', 'Advanced', 'Hosting experience.', true), (6, 'Languages', 'French', 'Intermediate', null, false),
  (7, 'Sports', 'Skateboarding', 'Advanced', null, true), (7, 'Languages', 'Japanese', 'Intermediate', null, true), (7, 'Dance', 'Hip-hop', 'Intermediate', null, false),
  (8, 'Sports', 'Soccer', 'Advanced', 'Club team, midfield.', true), (8, 'Dance', 'Contemporary', 'Intermediate', null, true),
  (9, 'Swimming', 'Competitive swimming', 'Advanced', null, true), (9, 'Musical Instruments', 'Guitar', 'Intermediate', null, true), (9, 'Languages', 'Korean', 'Intermediate', null, false),
  (10, 'Sports', 'Basketball', 'Advanced', 'Varsity guard.', true),
  (11, 'Dance', 'Contemporary', 'Professional', null, true), (11, 'Dance', 'Hip-hop', 'Advanced', null, true), (11, 'Modeling', 'Commercial print', 'Professional', null, true),
  (12, 'Acting', 'On-camera commercial', 'Professional', null, true), (12, 'Acting', 'Improv', 'Advanced', null, true), (12, 'Singing', 'Alto', 'Intermediate', null, false),
  (13, 'Musical Instruments', 'Piano', 'Advanced', null, true), (13, 'Languages', 'German', 'Intermediate', null, true), (13, 'Sports', 'Tennis', 'Intermediate', null, false),
  (14, 'Acting', 'Voice-over', 'Professional', 'Bilingual reel on file.', true), (14, 'Languages', 'Portuguese', 'Native', null, true), (14, 'Languages', 'Spanish', 'Advanced', null, true),
  (15, 'Languages', 'Hindi', 'Native', null, true), (15, 'Dance', 'Contemporary', 'Beginner', null, false),
  (16, 'Dance', 'Contemporary', 'Professional', null, true), (16, 'Modeling', 'Swim', 'Advanced', null, true), (16, 'Languages', 'French', 'Advanced', null, true),
  (17, 'Modeling', 'Editorial', 'Intermediate', null, true), (17, 'Sports', 'Skateboarding', 'Beginner', null, false),
  (18, 'Acting', 'On-camera commercial', 'Professional', null, true), (18, 'Other', 'Comfortable with animals', null, 'Has worked with dogs and horses on set.', true),
  (19, 'Martial Arts', 'Boxing', 'Advanced', null, true), (19, 'Sports', 'Distance running', 'Advanced', 'Trail ultras.', true), (19, 'Modeling', 'Fit modeling', 'Professional', null, true)
) as v(n, category, skill, level, notes, is_public)
join public.skill_categories c on c.name = v.category
join public.skills s on s.category_id = c.id and s.name = v.skill;

-- Mother and partner agencies.
insert into public.talent_agencies (talent_id, agency_id, agency_name, country, city, phone, mother_agency, mother_agency_percent, placement,
  contract_received, assigned_on, start_date, end_date, notes)
select demo_seed.t(v.n), a.id, a.name, a.country, a.city, a.phone, v.mother, v.mother_pct, v.placement, v.contract_received,
  demo_seed.today() - v.start_days, demo_seed.today() - v.start_days, case when v.end_days is null then null else demo_seed.today() + v.end_days end, v.notes
from (values
  (1, 'Kestrel Model Management', false, null, 'Main board women', true, 540, 190, 'New York placement. 42 remains mother agency (10%).'),
  (1, 'Harbourline Models', false, null, 'New faces, show package', true, 230, 135, 'London, spring show season.'),
  (2, 'Kestrel Model Management', false, null, 'Main board men', true, 610, 120, null),
  (3, 'Atelier Nord Models', false, null, 'Showroom season', false, 45, 320, 'Contract sent, awaiting countersignature.'),
  (4, 'Southwind Talent', false, null, 'Commercial men', true, 300, 65, 'Los Angeles, commercial and broadcast.'),
  (6, 'Southwind Talent', false, null, 'Curve', true, 410, 320, null),
  (8, 'Juniper Kids & Teens', true, 10, 'Teens', true, 700, null, 'Juniper is mother agency; we represent Zoe in Dallas-Fort Worth.'),
  (9, 'Juniper Kids & Teens', true, 10, 'Teens', true, 520, null, null),
  (11, 'Vela Milano', false, null, 'Development', false, 20, 345, 'Introductory placement for next season; polaroids requested.'),
  (13, 'Harbourline Models', false, null, 'Main board men', true, 280, 85, null),
  (24, 'Kestrel Model Management', false, null, 'Main board men', true, 1500, -400, 'Ended when Victor left modeling.')
) as v(n, agency, mother, mother_pct, placement, contract_received, start_days, end_days, notes)
join public.agencies a on a.name = v.agency;

-- Internal notes from different teammates.
insert into public.talent_notes (talent_id, note_type, body, created_by, created_at, updated_at)
select demo_seed.t(v.n), v.note_type, v.body, demo_seed.id('d0', v.author), demo_seed.ago(v.days_ago), demo_seed.ago(v.days_ago)
from (values
  (1, 'booking', 'Solene Atelier asked for Amara by name for the fall lookbook. Hold the dates until their creative director confirms the location.', 3, 6),
  (1, 'development', 'Book review with Sofia: retire the two oldest editorials, add the Blue Hour story once Verve & Thread releases the images.', 4, 21),
  (1, 'internal', 'Kestrel want her in New York for castings in the spring. Discuss travel budget at the next roster meeting.', 1, 40),
  (1, 'booking', 'Client feedback from Halden & Rowe: "the easiest day we have had all season." Requested again for spring.', 3, 50),
  (2, 'booking', 'Julian is training for a marathon: no bookings the first weekend of next month.', 3, 15),
  (2, 'internal', 'Passport expires soon. Reminded him twice; he has an appointment booked at the passport office.', 6, 8),
  (2, 'scouting', 'Kestrel report strong interest from two activewear clients after his last trip.', 4, 55),
  (3, 'booking', 'Trinity Bridal Collective confirmed Sienna as the opening look for the spring market show.', 3, 4),
  (3, 'internal', 'Contract renewal is due this month. Olivia to send the new three-year agreement.', 4, 10),
  (3, 'development', 'Needs stronger beauty images. Test with Carys Whitlow scheduled.', 5, 33),
  (4, 'internal', 'Visa renewal filed by his attorney. Do not confirm anything past the current expiry date until the receipt notice arrives.', 6, 12),
  (4, 'booking', 'Bluebonnet Denim extended usage on the fall images for six more months: see Usage tab.', 3, 28),
  (5, 'development', 'Noor wants to move fully to the main board after graduation. Revisit in the new year.', 4, 18),
  (5, 'booking', 'Lumera Skin loved her for the social content day and asked about a longer-term ambassador arrangement.', 3, 23),
  (6, 'booking', 'Fit session with Halden & Rowe cancelled by the client (sample delay). Half-fee cancellation invoiced.', 3, 9),
  (6, 'internal', 'All offers go through her manager Corinne as well. Payments to her loan-out company.', 6, 60),
  (7, 'development', 'Growing fast: measurements updated again. Three test shoots done, book is coming together.', 4, 38),
  (7, 'scouting', 'Summit Mile Athletics asked to see more of Kai after the spring catalog.', 3, 11),
  (8, 'internal', 'Guardian consent renewed for another year. Work permit renewal is coming up: Laura has the form.', 4, 14),
  (8, 'booking', 'School schedule: available after 4 pm on weekdays, all day on weekends and school holidays.', 3, 30),
  (9, 'internal', 'Ethan has grown out of his comp card sizes. New digitals needed before the next submission.', 4, 27),
  (10, 'booking', 'Basketball season starts soon: weekday availability will be limited to mornings on game days.', 3, 16),
  (11, 'booking', 'Imani prefers morning call times when she drives up from Houston the same day.', 3, 19),
  (11, 'development', 'Vela Milano interested for next season. Sent polaroids and walking video.', 4, 20),
  (12, 'booking', 'Reliable choice for healthcare clients. Ironwood Productions have her on first refusal for the hospital spot.', 3, 7),
  (13, 'booking', 'On option for the Verve & Thread "Open Road" story with Amara.', 3, 5),
  (14, 'internal', 'Contract expires next month. Rafael wants to stay non-exclusive for voice-over work: Olivia to review.', 4, 13),
  (15, 'development', 'Second test shoot delivered. Ready for a few low-pressure e-commerce bookings.', 5, 17),
  (16, 'booking', 'Camille confirmed for the spring bridal market in the curve segment.', 3, 4),
  (17, 'internal', 'Brief clients on pronouns (they/them) when confirming River.', 4, 25),
  (18, 'internal', 'Contract lapsed last week. Hannah is travelling; renewal call scheduled for when she is back.', 1, 3),
  (19, 'booking', 'Summit Mile Athletics holding Leo for the run club campaign. Waiting on their final dates.', 3, 6),
  (20, 'internal', 'Profile ready for review, but the guardian consent form is still outstanding. Do not publish until it is back.', 4, 2),
  (21, 'scouting', 'Applied through Join Us. Strong digitals, great walk at the open call. Approved by Daniel and Olivia.', 4, 12),
  (22, 'internal', 'Record came over from the previous booking system. Needs new digitals and a contract on file before publishing.', 2, 20),
  (23, 'internal', 'Enrolled through Model Expo. On hold until her onboarding call.', 4, 6),
  (24, 'internal', 'Victor has left modeling. Archived; keep the record for past bookings and payments.', 1, 90)
) as v(n, note_type, body, author, days_ago);

-- Items issued to talent.
select demo_seed.act_as('priya');
insert into public.talent_items (talent_id, item_type, description, size, condition, status, created_at)
select demo_seed.t(v.n), v.item_type, v.description, v.size, v.condition, v.status, demo_seed.ago(v.days_ago)
from (values
  (1, 'Portfolio book', 'Black leather agency book, 20 sleeves', '9 x 12 in', 'Good', 'issued', 400),
  (1, 'Comp cards', 'Box of 50, fall edition', null, 'New', 'issued', 30),
  (1, 'Nude seamless set', 'Agency set for fittings', 'S', 'Good', 'issued', 96),
  (2, 'Portfolio book', 'Black leather agency book', '9 x 12 in', 'Worn', 'issued', 600),
  (2, 'Comp cards', 'Box of 50', null, 'New', 'issued', 60),
  (3, 'Runway heels', 'Black pumps, 4 in, for castings', '9', 'Good', 'issued', 120),
  (3, 'Comp cards', 'Box of 50', null, 'New', 'issued', 20),
  (4, 'Portfolio book', 'Black leather agency book', '9 x 12 in', 'Good', 'returned', 150),
  (5, 'Tablet', 'Agency tablet with digital book, asset tag 0042', null, 'Good', 'issued', 75),
  (6, 'Comp cards', 'Box of 100, curve edition', null, 'New', 'issued', 45),
  (7, 'Comp cards', 'Box of 50, first print', null, 'New', 'issued', 40),
  (8, 'Comp cards', 'Box of 25, teen edition', null, 'New', 'issued', 55),
  (11, 'Garment bag', 'Agency garment bag for travel bookings', null, 'Good', 'issued', 130),
  (13, 'Studio key card', 'Access card for Studio B, weekday test shoots', null, 'Good', 'returned', 200),
  (24, 'Portfolio book', 'Black leather agency book', '9 x 12 in', 'Worn', 'lost', 900)
) as v(n, item_type, description, size, condition, status, days_ago);

-- ---------------------------------------------------------------------------
-- Sensitive modules (audited by database triggers without their values)
-- ---------------------------------------------------------------------------
-- Legal, contracts and identification. Several expiries fall inside the next 60
-- days so the dashboard alerts have content; one contract has just lapsed.
select demo_seed.act_as('henry');
insert into public.talent_legal (talent_id, legal_first_name, legal_middle_name, legal_last_name, company_name, non_resident, freelancer, own_tax_responsible,
  tax_number, accounting_number, talent_commission_percent, credit_status,
  contract_name, contract_signed_on, contract_returned, contract_expires_on,
  passport_number, passport_country, passport_issued_on, passport_expires_on, visa_type, visa_expires_on,
  work_permit_number, work_permit_country, work_permit_issued_on, work_permit_expires_on,
  driver_license_number, driver_license_state, driver_license_expires_on)
select demo_seed.t(v.n), v.legal_first, v.legal_middle, v.legal_last, v.company, v.non_resident, true, true,
  'XXX-XX-' || lpad((1000 + v.n)::text, 4, '0'), 'TAL-' || lpad(v.n::text, 4, '0'), v.commission, 'Good standing',
  v.contract_name, demo_seed.today() - v.signed_days, true, demo_seed.today() + v.contract_in,
  v.passport_number, v.passport_country, case when v.passport_in is null then null else demo_seed.today() + v.passport_in - 3650 end,
  case when v.passport_in is null then null else demo_seed.today() + v.passport_in end, v.visa_type,
  case when v.visa_in is null then null else demo_seed.today() + v.visa_in end,
  v.permit_number, case when v.permit_number is null then null else 'United States' end,
  case when v.permit_in is null then null else demo_seed.today() + v.permit_in - 365 end,
  case when v.permit_in is null then null else demo_seed.today() + v.permit_in end,
  v.license_number, case when v.license_number is null then null else 'TX' end,
  case when v.license_number is null then null else demo_seed.today() + 400 + v.n * 37 end
from (values
  (1, 'Amara', 'Jolene', 'Cole', null, false, 20, 'Exclusive representation: Texas and Southwest', 1080, 380, 'X00000101', 'United States', 1460, null, null, null, null, 'DEMO-1000101'),
  (2, 'Julian', 'Andres', 'Reyes', null, false, 20, 'Exclusive representation: Texas and Southwest', 1000, 460, 'X00000102', 'United States', 33, null, null, null, null, 'DEMO-1000102'),
  (3, 'Sienna', 'Rae', 'Brooks', null, false, 20, 'Exclusive representation: Texas', 1078, 18, 'X00000103', 'United States', 900, null, null, null, null, 'DEMO-1000103'),
  (4, 'Mateo', null, 'Alvarez', null, true, 20, 'Exclusive representation: Texas', 700, 395, 'G00000104', 'Mexico', 1250, 'O-1B (extraordinary ability, arts)', 27, null, null, 'DEMO-1000104'),
  (5, 'Noor', 'Layla', 'Haddad', null, false, 20, 'Exclusive representation: Texas', 540, 555, 'X00000105', 'United States', 2100, null, null, null, null, 'DEMO-1000105'),
  (6, 'Elise', 'Marie', 'Fontaine', 'Fontaine Creative LLC', false, 20, 'Exclusive representation: Texas and Southwest', 980, 115, 'X00000106', 'United States', 1700, null, null, null, null, 'DEMO-1000106'),
  (7, 'Kai', 'Haruto', 'Nakamura', null, false, 20, 'Development agreement (two years)', 310, 420, null, null, null, null, null, null, null, 'DEMO-1000107'),
  (8, 'Zoe', 'Elizabeth', 'Whitfield', null, false, 20, 'Minor representation agreement (guardian signed)', 420, 310, 'X00000108', 'United States', 1100, null, null, 'TX-CA-0000-0108', 24, null),
  (9, 'Ethan', 'Min-jun', 'Park', null, false, 20, 'Minor representation agreement (guardian signed)', 365, 365, null, null, null, null, null, 'TX-CA-0000-0109', 47, null),
  (10, 'Lucas', 'James', 'Bennett', null, false, 20, 'Minor representation agreement (guardian signed)', 250, 480, null, null, null, null, null, 'TX-CA-0000-0110', 170, null),
  (11, 'Imani', 'Adaeze', 'Okoye', null, false, 20, 'Exclusive representation: Texas', 670, 425, 'X00000111', 'United States', 52, null, null, null, null, 'DEMO-1000111'),
  (12, 'Grace', 'Ann', 'Sullivan', null, false, 15, 'Non-exclusive commercial representation', 1500, 325, null, null, null, null, null, null, null, 'DEMO-1000112'),
  (13, 'Theo', 'Erik', 'Lindgren', null, false, 20, 'Exclusive representation: Texas', 480, 250, 'X00000113', 'United States', 2600, null, null, null, null, 'DEMO-1000113'),
  (14, 'Rafael', 'Henrique', 'Costa', null, false, 15, 'Non-exclusive commercial representation', 1055, 41, 'X00000114', 'United States', 800, null, null, null, null, 'DEMO-1000114'),
  (16, 'Camille', 'Therese', 'Durand', null, false, 20, 'Exclusive representation: Texas', 610, 485, null, null, null, null, null, null, null, 'DEMO-1000116'),
  (18, 'Hannah', 'Ruth', 'Weiss', null, false, 15, 'Non-exclusive commercial representation', 1101, -6, null, null, null, null, null, null, null, 'DEMO-1000118'),
  (19, 'Leo', 'Augusto', 'Martins', null, false, 20, 'Exclusive representation: Texas', 830, 265, 'X00000119', 'United States', 1900, null, null, null, null, 'DEMO-1000119'),
  (24, 'Victor', 'Alan', 'Hale', null, false, 20, 'Exclusive representation: Texas (ended)', 1900, null, null, null, null, null, null, null, null, null)
) as v(n, legal_first, legal_middle, legal_last, company, non_resident, commission, contract_name, signed_days, contract_in,
       passport_number, passport_country, passport_in, visa_type, visa_in, permit_number, permit_in, license_number);

update public.talent_legal set stop_payments = true, stop_payments_notes = 'Final statement settled. No further payments expected.', credit_status = 'Closed'
where talent_id = demo_seed.t(24);
update public.talent_legal set account_balance = 1840.00, reserve_amount = 250.00 where talent_id = demo_seed.t(1);
update public.talent_legal set talent_tax_percent = 30, insurance_number = 'ITIN on file' where talent_id = demo_seed.t(4);

-- Banking: obviously fake numbers (masked in the dashboard).
insert into public.talent_banking (talent_id, description, contact, account_name, account_number, routing_number, swift_aba)
select demo_seed.t(v.n), v.description, v.contact, v.account_name, '0000' || lpad((v.n * 1111)::text, 8, '0'), '000000000', v.swift
from (values
  (1, 'Checking: direct deposit, paid on the 15th', null, 'Amara J. Cole', null),
  (2, 'Checking: direct deposit', null, 'Julian A. Reyes', null),
  (3, 'Checking: direct deposit', null, 'Sienna R. Brooks', null),
  (4, 'Checking: direct deposit. 30% withholding applies.', null, 'Mateo Alvarez', 'DEMOUS00XXX'),
  (5, 'Savings: direct deposit', null, 'Noor L. Haddad', null),
  (6, 'Business checking: pay the loan-out company', 'Corinne Abel', 'Fontaine Creative LLC', null),
  (7, 'Checking: direct deposit', null, 'Kai H. Nakamura', null),
  (8, 'Custodial (blocked trust) account: 15% of gross earnings', 'Laura Whitfield', 'Laura Whitfield, custodian for Zoe Whitfield', null),
  (9, 'Custodial (blocked trust) account: 15% of gross earnings', 'David Park', 'David Park, custodian for Ethan Park', null),
  (11, 'Checking: direct deposit', null, 'Imani A. Okoye', null),
  (12, 'Checking: direct deposit', null, 'Grace A. Sullivan', null),
  (14, 'Checking: direct deposit', null, 'Rafael H. Costa', null)
) as v(n, description, contact, account_name, swift);

-- Medical: benign notes only, for a few talent.
select demo_seed.act_as('daniel');
insert into public.talent_medical (talent_id, doctor, office_address, office_phone, last_visit, medical_notes, medical_approval, valid_through, last_image_date, availability)
values
  (demo_seed.t(1), 'Dr. Helena Voss', '1200 Meadowmont Medical Plaza, Suite 210, Dallas, TX 75231', '(214) 555-0171', demo_seed.today() - 140,
    'Seasonal pollen allergy; carries her own antihistamine. Vegetarian. No restrictions on set.', 'Cleared for all work', demo_seed.today() + 225, demo_seed.today() - 96, 'No restrictions'),
  (demo_seed.t(8), 'Dr. Arjun Mehta', '880 Prairie Creek Pediatrics, Frisco, TX 75034', '(469) 555-0172', demo_seed.today() - 60,
    'Wears contact lenses; bring glasses as a backup for long days. Sports physical on file for the school year.', 'Cleared for all work', demo_seed.today() + 300, demo_seed.today() - 55, 'After school and weekends'),
  (demo_seed.t(6), 'Dr. Naomi Castellan', '4310 Legacy Health Pavilion, Plano, TX 75024', '(972) 555-0173', demo_seed.today() - 210,
    'Mild lactose intolerance: note for catering. No restrictions on set.', 'Cleared for all work', demo_seed.today() + 155, demo_seed.today() - 110, 'No restrictions'),
  (demo_seed.t(19), 'Dr. Owen Baptiste', '2200 Trinity Sports Medicine, Dallas, TX 75207', '(214) 555-0174', demo_seed.today() - 35,
    'Recovered from a sprained left ankle; cleared for running and jump work.', 'Cleared for stunts and fitness work', demo_seed.today() + 330, demo_seed.today() - 85, 'No restrictions');

-- Private documents (the files themselves are generated by the sandbox).
select demo_seed.act_as('henry');
insert into public.talent_documents (id, talent_id, file_name, storage_path, description, category, visibility, mime_type, file_size, shared_with_talent, created_at)
select demo_seed.id('dc', v.k), demo_seed.t(v.n), v.file_name,
  'talent/' || demo_seed.t(v.n) || '/' || demo_seed.id('dc', v.k) || '-' || v.file_name,
  v.description, v.category, v.visibility, 'application/pdf', v.size_kb * 1024, v.shared, demo_seed.ago(v.days_ago)
from (values
  (1, 1, 'representation-agreement-signed.pdf', 'Exclusive representation agreement, countersigned.', 'Contract', 'private', 412, true, 1080),
  (2, 1, 'w-9-form.pdf', 'Tax form on file.', 'Tax', 'private', 96, false, 1075),
  (3, 1, 'passport-copy.pdf', 'Photo page, for travel bookings.', 'ID', 'private', 780, false, 600),
  (4, 1, 'voucher-halden-rowe-holiday-lookbook.pdf', 'Signed voucher for the Halden & Rowe holiday lookbook.', 'Voucher', 'staff', 143, true, 50),
  (5, 1, 'call-sheet-solene-atelier-showroom-fittings.pdf', 'Call sheet: showroom fittings, parking and contacts.', 'Call sheet', 'staff', 188, true, 2),
  (6, 1, 'statement-last-quarter.pdf', 'Earnings statement for the last quarter.', 'Statement', 'private', 121, true, 18),
  (7, 2, 'representation-agreement-signed.pdf', 'Exclusive representation agreement.', 'Contract', 'private', 398, true, 1000),
  (8, 2, 'kestrel-placement-agreement.pdf', 'New York placement agreement with Kestrel Model Management.', 'Contract', 'staff', 367, false, 610),
  (9, 3, 'contract-renewal-draft.pdf', 'Three-year renewal, sent for signature.', 'Contract', 'staff', 402, false, 9),
  (10, 4, 'visa-approval-notice.pdf', 'Current approval notice. Renewal filed by Ruiz & Tate.', 'ID', 'private', 655, false, 330),
  (11, 4, 'usage-extension-bluebonnet-denim.pdf', 'Six-month usage extension, countersigned.', 'Contract', 'staff', 204, true, 28),
  (12, 6, 'loan-out-agreement-fontaine-creative.pdf', 'Loan-out agreement and company tax form.', 'Contract', 'private', 455, false, 900),
  (13, 8, 'guardian-consent-form.pdf', 'Signed by Laura Whitfield. Renewed for the current school year.', 'Guardian consent', 'private', 232, false, 14),
  (14, 8, 'work-permit-minor.pdf', 'Child performer work permit. Renewal form sent to guardian.', 'Work permit', 'private', 178, false, 341),
  (15, 9, 'guardian-consent-form.pdf', 'Signed by David Park.', 'Guardian consent', 'private', 229, false, 360),
  (16, 10, 'guardian-consent-form.pdf', 'Signed by Renee Bennett.', 'Guardian consent', 'private', 231, false, 248),
  (17, 11, 'representation-agreement-signed.pdf', 'Exclusive representation agreement.', 'Contract', 'private', 405, true, 670),
  (18, 14, 'voice-over-reel-notes.pdf', 'Session notes and client list for the voice-over reel.', 'Other', 'staff', 88, false, 120),
  (19, 5, 'representation-agreement-signed.pdf', 'Exclusive representation agreement.', 'Contract', 'private', 401, true, 540),
  (20, 24, 'final-statement.pdf', 'Final earnings statement at the end of representation.', 'Statement', 'private', 117, false, 80)
) as v(k, n, file_name, description, category, visibility, size_kb, shared, days_ago);

update public.talent_documents set archived_at = demo_seed.ago(70) where id = demo_seed.id('dc', 20);

-- ===========================================================================
-- 6. Media
-- ===========================================================================
-- Originals live in talent-private at talent/<talent id>/<file>; a photo that is
-- public also has a copy in talent-public at talent/<talent id>/<photo id>-<file>
-- (the same convention as src/features/media/publish.ts). Photo 1 of each talent is
-- the cover. The sandbox generates the image files from these rows.
select demo_seed.act_as('sofia');

insert into public.talent_photos (id, talent_id, storage_bucket, storage_path, public_storage_path, title, alt_text, photographer, image_type,
  is_cover, featured, portfolio_order, display_order, "public", publish_to_website, type_of_work, support_name, country_of_publication,
  original_file_name, review_status, source, created_at, updated_at)
select demo_seed.photo(v.t, v.n), t.id, 'talent-private',
  'talent/' || t.id || '/' || v.file_name,
  case when v.is_public then 'talent/' || t.id || '/' || demo_seed.photo(v.t, v.n) || '-' || v.file_name end,
  v.title, case when v.title is not null then t.display_name || ' — ' || v.title end, v.photographer, v.image_type,
  v.n = 1, v.n = 1, v.n, v.n, v.is_public, v.is_public, v.work, v.support, case when v.support is not null then 'United States' end,
  upper(left(t.first_name, 1) || left(t.last_name, 1)) || '_' || replace(v.file_name, '-', '_'), 'approved',
  case when v.t in (16, 19, 22) then 'cds' when v.t = 21 then 'application' when v.t = 23 then 'ghl' else 'upload' end,
  demo_seed.ago(greatest(1, least(t.joined_days - 3, 45 + v.t * 9) - v.n * 2)), demo_seed.ago(greatest(1, least(t.joined_days - 3, 45 + v.t * 9) - v.n * 2))
from (
  select x.*, x.image_type || '-' || lpad(x.n::text, 2, '0') || '.jpg' as file_name
  from (values
    (1, 1, 'portfolio', 'Studio portrait in ivory tailoring', 'Mara Ellison', true, 'Test', null),
    (1, 2, 'editorial', 'Blue Hour: rooftop at dusk', 'Tobias Venn', true, 'Editorial', 'Verve & Thread'),
    (1, 3, 'campaign', 'Solene Atelier resort campaign, look 4', 'Lena Marchetti', true, 'Campaign', 'Solene Atelier'),
    (1, 4, 'portfolio', 'Black-and-white beauty close-up', 'Mara Ellison', true, 'Beauty', null),
    (1, 5, 'portfolio', 'Movement study in red silk', 'Carys Whitlow', true, 'Test', null),
    (1, 6, 'digital', 'Digital: front', '42 Studio', true, 'Digitals', null),
    (1, 7, 'digital', 'Digital: profile', '42 Studio', true, 'Digitals', null),
    (1, 8, 'digital', 'Digital: full length', '42 Studio', true, 'Digitals', null),
    (1, 9, 'polaroid', 'Backstage polaroid, bridal market', '42 Studio', false, 'Runway', null),
    (2, 1, 'portfolio', 'Charcoal suit against concrete', 'Tobias Venn', true, 'Test', null),
    (2, 2, 'campaign', 'Bluebonnet Denim fall campaign', 'Idris Okonjo', true, 'Campaign', 'Bluebonnet Denim Co.'),
    (2, 3, 'editorial', 'Blue Hour: the long way home', 'Tobias Venn', true, 'Editorial', 'Verve & Thread'),
    (2, 4, 'portfolio', 'Track session at golden hour', 'Jonas Pryce', true, 'Sportswear', null),
    (2, 5, 'headshot', 'Commercial headshot, natural light', 'Mara Ellison', true, 'Headshot', null),
    (2, 6, 'digital', 'Digital: front', '42 Studio', true, 'Digitals', null),
    (2, 7, 'digital', 'Digital: full length', '42 Studio', true, 'Digitals', null),
    (3, 1, 'portfolio', 'Runway finale, ivory column gown', 'Lena Marchetti', true, 'Runway', 'Trinity Bridal Collective'),
    (3, 2, 'portfolio', 'Showroom look in sage linen', 'Carys Whitlow', true, 'Lookbook', null),
    (3, 3, 'campaign', 'Halden & Rowe holiday lookbook', 'Mara Ellison', true, 'Lookbook', 'Halden & Rowe'),
    (3, 4, 'portfolio', 'Western editorial on horseback', 'Jonas Pryce', true, 'Test', null),
    (3, 5, 'headshot', 'Clean beauty headshot', 'Carys Whitlow', true, 'Beauty', null),
    (3, 6, 'digital', 'Digital: front', '42 Studio', true, 'Digitals', null),
    (3, 7, 'digital', 'Digital: profile', '42 Studio', true, 'Digitals', null),
    (4, 1, 'portfolio', 'Denim on denim, studio', 'Idris Okonjo', true, 'Test', null),
    (4, 2, 'campaign', 'Bluebonnet Denim fall e-commerce', 'Idris Okonjo', true, 'E-commerce', 'Bluebonnet Denim Co.'),
    (4, 3, 'portfolio', 'Linen suit on the Gulf coast', 'Jonas Pryce', true, 'Test', null),
    (4, 4, 'headshot', 'Commercial headshot, smiling', 'Mara Ellison', true, 'Headshot', null),
    (4, 5, 'digital', 'Digital: front', '42 Studio', true, 'Digitals', null),
    (4, 6, 'digital', 'Digital: full length', '42 Studio', false, 'Digitals', null),
    (5, 1, 'portfolio', 'Profile study with sculptural earring', 'Carys Whitlow', true, 'Beauty', null),
    (5, 2, 'campaign', 'Lumera Skin social campaign', 'Lena Marchetti', true, 'Beauty', 'Lumera Skin'),
    (5, 3, 'editorial', 'Architectural lines, downtown Dallas', 'Tobias Venn', true, 'Editorial', 'Meridian Journal'),
    (5, 4, 'portfolio', 'Monochrome knitwear story', 'Mara Ellison', true, 'Test', null),
    (5, 5, 'digital', 'Digital: front', '42 Studio', true, 'Digitals', null),
    (5, 6, 'digital', 'Digital: profile', '42 Studio', true, 'Digitals', null),
    (6, 1, 'portfolio', 'Emerald swimsuit at the pool', 'Lena Marchetti', true, 'Swim', null),
    (6, 2, 'campaign', 'Paloma Swim summer campaign', 'Lena Marchetti', true, 'Campaign', 'Paloma Swim'),
    (6, 3, 'portfolio', 'Soft tailoring in camel', 'Mara Ellison', true, 'Test', null),
    (6, 4, 'portfolio', 'Morning yoga flow, lifestyle', 'Jonas Pryce', true, 'Lifestyle', null),
    (6, 5, 'headshot', 'Beauty headshot, auburn waves', 'Carys Whitlow', true, 'Beauty', null),
    (6, 6, 'digital', 'Digital: front', '42 Studio', true, 'Digitals', null),
    (6, 7, 'digital', 'Digital: full length', '42 Studio', true, 'Digitals', null),
    (7, 1, 'portfolio', 'Streetwear portrait under the overpass', 'Idris Okonjo', true, 'Test', null),
    (7, 2, 'portfolio', 'Skate park at dusk', 'Idris Okonjo', true, 'Test', null),
    (7, 3, 'campaign', 'Summit Mile Athletics spring catalog', 'Jonas Pryce', true, 'Catalog', 'Summit Mile Athletics'),
    (7, 4, 'headshot', 'Clean headshot, white tee', 'Mara Ellison', true, 'Headshot', null),
    (7, 5, 'digital', 'Digital: front', '42 Studio', true, 'Digitals', null),
    (8, 1, 'portfolio', 'Back-to-school lifestyle portrait', 'Mara Ellison', true, 'Lifestyle', null),
    (8, 2, 'campaign', 'Halden & Rowe teen holiday catalog', 'Mara Ellison', true, 'Catalog', 'Halden & Rowe'),
    (8, 3, 'portfolio', 'Soccer field, action shot', 'Jonas Pryce', true, 'Sportswear', null),
    (8, 4, 'headshot', 'Smiling headshot, natural light', 'Carys Whitlow', true, 'Headshot', null),
    (8, 5, 'digital', 'Digital: front', '42 Studio', false, 'Digitals', null),
    (9, 1, 'portfolio', 'Denim jacket lifestyle portrait', 'Mara Ellison', true, 'Lifestyle', null),
    (9, 2, 'portfolio', 'Poolside, swim team story', 'Jonas Pryce', true, 'Sportswear', null),
    (9, 3, 'headshot', 'Commercial headshot', 'Carys Whitlow', true, 'Headshot', null),
    (9, 4, 'portfolio', 'With guitar, studio', 'Mara Ellison', true, 'Test', null),
    (9, 5, 'digital', 'Digital: front', '42 Studio', false, 'Digitals', null),
    (10, 1, 'portfolio', 'Varsity jacket portrait', 'Idris Okonjo', true, 'Lifestyle', null),
    (10, 2, 'campaign', 'Halden & Rowe teen holiday catalog', 'Mara Ellison', true, 'Catalog', 'Halden & Rowe'),
    (10, 3, 'portfolio', 'Basketball court, in motion', 'Jonas Pryce', true, 'Sportswear', null),
    (10, 4, 'headshot', 'Commercial headshot', 'Carys Whitlow', true, 'Headshot', null),
    (11, 1, 'portfolio', 'Saffron dress in motion', 'Carys Whitlow', true, 'Test', null),
    (11, 2, 'campaign', 'Solene Atelier resort campaign, look 9', 'Lena Marchetti', true, 'Campaign', 'Solene Atelier'),
    (11, 3, 'portfolio', 'Beauty portrait with gold leaf', 'Carys Whitlow', true, 'Beauty', null),
    (11, 4, 'portfolio', 'Runway, spring bridal market', 'Lena Marchetti', true, 'Runway', 'Trinity Bridal Collective'),
    (11, 5, 'digital', 'Digital: front', '42 Studio', true, 'Digitals', null),
    (11, 6, 'digital', 'Digital: profile', '42 Studio', true, 'Digitals', null),
    (12, 1, 'headshot', 'Warm commercial headshot', 'Mara Ellison', true, 'Headshot', null),
    (12, 2, 'portfolio', 'Kitchen lifestyle for a family brand', 'Jonas Pryce', true, 'Lifestyle', null),
    (12, 3, 'campaign', 'Regional bank commercial still', 'Ironwood Productions', true, 'Broadcast', 'Ironwood Productions'),
    (12, 4, 'portfolio', 'Healthcare lifestyle, nurse role', 'Jonas Pryce', true, 'Commercial', null),
    (12, 5, 'digital', 'Digital: front', '42 Studio', true, 'Digitals', null),
    (13, 1, 'portfolio', 'Overcoat on a winter street', 'Tobias Venn', true, 'Test', null),
    (13, 2, 'campaign', 'Bluebonnet Denim fall e-commerce', 'Idris Okonjo', true, 'E-commerce', 'Bluebonnet Denim Co.'),
    (13, 3, 'portfolio', 'At the piano, black tie', 'Tobias Venn', true, 'Test', null),
    (13, 4, 'headshot', 'Clean headshot, grey knit', 'Mara Ellison', true, 'Headshot', null),
    (13, 5, 'digital', 'Digital: front', '42 Studio', true, 'Digitals', null),
    (14, 1, 'headshot', 'Friendly professional headshot', 'Mara Ellison', true, 'Headshot', null),
    (14, 2, 'campaign', 'Regional bank commercial still', 'Ironwood Productions', true, 'Broadcast', 'Ironwood Productions'),
    (14, 3, 'portfolio', 'Weekend dad lifestyle, backyard grill', 'Jonas Pryce', true, 'Lifestyle', null),
    (14, 4, 'portfolio', 'In the recording booth', 'Tobias Venn', true, 'Commercial', null),
    (15, 1, 'portfolio', 'First test: cobalt blazer', 'Carys Whitlow', true, 'Test', null),
    (15, 2, 'portfolio', 'Natural light beauty', 'Carys Whitlow', true, 'Beauty', null),
    (15, 3, 'portfolio', 'Streetwear in front of a mural', 'Idris Okonjo', true, 'Test', null),
    (15, 4, 'digital', 'Digital: front', '42 Studio', true, 'Digitals', null),
    (15, 5, 'digital', 'Digital: full length', '42 Studio', true, 'Digitals', null),
    (16, 1, 'portfolio', 'Activewear in motion', 'Jonas Pryce', true, 'Sportswear', null),
    (16, 2, 'portfolio', 'Coral swimsuit on the lake dock', 'Lena Marchetti', true, 'Swim', null),
    (16, 3, 'campaign', 'Summit Mile Athletics spring catalog', 'Jonas Pryce', true, 'Catalog', 'Summit Mile Athletics'),
    (16, 4, 'portfolio', 'Runway, curve segment', 'Lena Marchetti', true, 'Runway', 'Trinity Bridal Collective'),
    (16, 5, 'digital', 'Digital', null, true, 'Digitals', null),
    (17, 1, 'portfolio', 'Bleached crop and graphic liner', 'Carys Whitlow', true, 'Beauty', null),
    (17, 2, 'portfolio', 'Oversized suiting, studio', 'Tobias Venn', true, 'Test', null),
    (17, 3, 'portfolio', 'In the painting studio', 'Idris Okonjo', true, 'Test', null),
    (17, 4, 'digital', 'Digital: front', '42 Studio', true, 'Digitals', null),
    (18, 1, 'headshot', 'Warm headshot, teacher role', 'Mara Ellison', true, 'Headshot', null),
    (18, 2, 'portfolio', 'Family breakfast lifestyle', 'Jonas Pryce', true, 'Lifestyle', null),
    (18, 3, 'campaign', 'Regional bank commercial still', 'Ironwood Productions', true, 'Broadcast', 'Ironwood Productions'),
    (18, 4, 'portfolio', 'Garden center, retail lifestyle', 'Jonas Pryce', true, 'Commercial', null),
    (19, 1, 'portfolio', 'Boxing gym, hand wraps', 'Idris Okonjo', true, 'Fitness', null),
    (19, 2, 'campaign', 'Summit Mile Athletics spring catalog', 'Jonas Pryce', true, 'Catalog', 'Summit Mile Athletics'),
    (19, 3, 'portfolio', 'Trail run at sunrise', 'Jonas Pryce', true, 'Fitness', null),
    (19, 4, 'portfolio', 'Navy suit on the city commute', 'Tobias Venn', true, 'Test', null),
    (19, 5, 'headshot', 'Commercial headshot', 'Mara Ellison', true, 'Headshot', null),
    (19, 6, 'digital', 'Digital', null, true, 'Digitals', null),
    (20, 1, 'portfolio', 'First test: denim and white tee', 'Carys Whitlow', false, 'Test', null),
    (20, 2, 'portfolio', 'First test: at the stables', 'Carys Whitlow', false, 'Test', null),
    (20, 3, 'digital', 'Digital: front', '42 Studio', false, 'Digitals', null),
    (21, 1, 'digital', 'headshot', null, false, null, null),
    (21, 2, 'digital', 'full body', null, false, null, null),
    (22, 1, 'portfolio', null, null, false, null, null),
    (22, 2, 'portfolio', null, null, false, null, null),
    (22, 3, 'digital', 'Digital', null, false, null, null),
    (23, 1, 'headshot', 'Headshot', null, false, null, null),
    (23, 2, 'digital', 'Full body', null, false, null, null),
    (24, 1, 'portfolio', 'Tailoring portrait', 'Tobias Venn', false, 'Test', null),
    (24, 2, 'headshot', 'Commercial headshot', 'Mara Ellison', false, 'Headshot', null)
  ) as x(t, n, image_type, title, photographer, is_public, work, support)
) as v
join (select tt.*, (demo_seed.today() - tt.date_joined) as joined_days from public.talent tt) t on t.id = demo_seed.t(v.t);

select public.write_audit('media.uploaded', 'talent', talent_id, jsonb_build_object('photo_id', id))
from public.talent_photos where is_cover order by created_at;

-- Portfolios: a default book for ten talent, plus a few themed ones.
insert into public.portfolios (id, talent_id, name, slug, description, "public", is_default, display_order)
select demo_seed.id('a5', v.k), demo_seed.t(v.n), v.name, v.slug, v.description, true, v.is_default, v.position
from (values
  (1, 1, 'Portfolio', 'portfolio', 'Main book.', true, 0), (101, 1, 'Editorial', 'editorial', 'Published stories and campaigns.', false, 1),
  (2, 2, 'Portfolio', 'portfolio', 'Main book.', true, 0), (102, 2, 'Sportswear', 'sportswear', 'Running, training and denim.', false, 1),
  (3, 3, 'Portfolio', 'portfolio', 'Main book.', true, 0), (103, 3, 'Runway', 'runway', 'Shows and showroom.', false, 1),
  (4, 4, 'Portfolio', 'portfolio', 'Main book.', true, 0),
  (5, 5, 'Portfolio', 'portfolio', 'Main book.', true, 0),
  (6, 6, 'Portfolio', 'portfolio', 'Main book.', true, 0), (106, 6, 'Swim', 'swim', 'Swim and resort.', false, 1),
  (7, 7, 'Portfolio', 'portfolio', 'Development book.', true, 0),
  (11, 11, 'Portfolio', 'portfolio', 'Main book.', true, 0),
  (13, 13, 'Portfolio', 'portfolio', 'Main book.', true, 0),
  (16, 16, 'Fashion-Women', 'fashion-women', 'Imported with the photos from the previous booking system.', true, 0),
  (19, 19, 'Commercial-Men', 'commercial-men', 'Imported with the photos from the previous booking system.', true, 0)
) as v(k, n, name, slug, description, is_default, position);

-- Default books hold every approved portfolio image, in gallery order.
insert into public.portfolio_images (portfolio_id, photo_id, display_order)
select pf.id, p.id, p.display_order
from public.portfolios pf
join public.talent_photos p on p.talent_id = pf.talent_id and p.image_type <> 'digital' and p."public"
where pf.is_default;

insert into public.portfolio_images (portfolio_id, photo_id, display_order)
select demo_seed.id('a5', v.k), demo_seed.photo(v.t, v.n), v.position
from (values
  (101, 1, 2, 1), (101, 1, 3, 2), (101, 1, 5, 3),
  (102, 2, 4, 1), (102, 2, 2, 2),
  (103, 3, 1, 1), (103, 3, 2, 2),
  (106, 6, 1, 1), (106, 6, 2, 2)
) as v(k, t, n, position);

-- Digital books (plain casting snapshots), shown in their own section on the website.
insert into public.digital_books (id, talent_id, name, "public", display_order, created_at)
select demo_seed.id('a6', v.n), demo_seed.t(v.n), v.name, v.is_public, 0, demo_seed.ago(v.days_ago)
from (values (1, 'Digitals', true, 96), (2, 'Digitals', true, 60), (3, 'Digitals', true, 120), (5, 'Digitals', true, 75),
             (11, 'Digitals', true, 130), (15, 'Signing digitals', true, 180), (4, 'Digitals (to be reshot)', false, 150)) as v(n, name, is_public, days_ago);

insert into public.digital_book_images (book_id, photo_id, display_order)
select b.id, p.id, p.display_order
from public.digital_books b
join public.talent_photos p on p.talent_id = b.talent_id and p.image_type = 'digital';

-- ===========================================================================
-- 7. Videos: none. The demo keeps talent_videos empty rather than point at a real
--    YouTube or Vimeo id; uploads can be tried from a talent's Media tab.
-- ===========================================================================

-- ===========================================================================
-- 8. Publication
-- ===========================================================================
-- Publishing is an update, as in the app, so the publication trigger checks the
-- talent.publish permission and writes the audit events.
select demo_seed.act_as('daniel');
update public.talent set publication_status = 'published', show_on_website = true, show_in_search = true
where id in (select demo_seed.t(n) from generate_series(1, 19) as n);

select demo_seed.act_as('olivia');
update public.talent set featured = true where id in (demo_seed.t(1), demo_seed.t(2), demo_seed.t(3), demo_seed.t(6), demo_seed.t(11));

-- Ava waits in review until her guardian consent is back; Victor has left.
select demo_seed.act_as('daniel');
update public.talent set publication_status = 'review' where id = demo_seed.t(20);
select demo_seed.act_as('olivia');
update public.talent set publication_status = 'archived', archived_at = demo_seed.ago(80) where id = demo_seed.t(24);

-- ===========================================================================
-- 9. Companies and contacts
-- ===========================================================================
select demo_seed.act_as('priya');

insert into public.companies (id, name, kind, website, email, phone, address_1, city, state, postal_code, country, billing_email, notes, is_active, created_at)
select demo_seed.id('c0', v.n), v.name, v.kind, v.website, v.email, v.phone, v.address_1, v.city, v.state, v.postal_code, 'United States', v.billing_email, v.notes, v.is_active, demo_seed.ago(v.days_ago)
from (values
  (1, 'Halden & Rowe', 'client', 'https://haldenrowe.example', 'studio@haldenrowe.example', '(214) 555-0150', '1400 Commerce Row', 'Dallas', 'TX', '75201', 'ap@haldenrowe.example',
    'Regional department store. Four lookbooks a year plus teen and home catalogs. Pays net 30, reliably. Prefers options packages a week ahead.', true, 900),
  (2, 'Solene Atelier', 'brand', 'https://soleneatelier.example', 'hello@soleneatelier.example', '(214) 555-0151', '88 Dragon Mill Street, Studio 5', 'Dallas', 'TX', '75207', 'accounts@soleneatelier.example',
    'Contemporary womenswear designer. Books two campaigns and two lookbooks a year; always asks for Amara first. Usage is worldwide: quote accordingly.', true, 700),
  (3, 'Bluebonnet Denim Co.', 'brand', 'https://bluebonnetdenim.example', 'creative@bluebonnetdenim.example', '(512) 555-0152', '410 Tannery Yard', 'Austin', 'TX', '78702', 'billing@bluebonnetdenim.example',
    'Austin denim label. E-commerce every season and one location campaign. Slow payer: chase invoices at 30 days.', true, 640),
  (4, 'Lumera Skin', 'brand', 'https://lumeraskin.example', 'marketing@lumeraskin.example', '(469) 555-0153', '2600 Gallery Park Drive, Suite 300', 'Plano', 'TX', '75024', 'finance@lumeraskin.example',
    'Skincare start-up. Social content days and launch events. Looking for a longer-term ambassador.', true, 260),
  (5, 'Marlowe Casting', 'casting', 'https://marlowecasting.example', 'submissions@marlowecasting.example', '(214) 555-0154', '2200 Elm Hollow, Suite B', 'Dallas', 'TX', '75226', null,
    'Commercial and series casting. Send submissions by 10 am for same-week sessions. Teens need a guardian in the room.', true, 820),
  (6, 'Ironwood Productions', 'production', 'https://ironwoodproductions.example', 'producers@ironwoodproductions.example', '(512) 555-0155', '7700 Stagecoach Park, Soundstage 2', 'Austin', 'TX', '78744', 'payables@ironwoodproductions.example',
    'Broadcast production company: regional banks, healthcare, automotive. Books commercial talent on first refusal, then confirms a week out.', true, 560),
  (7, 'Mara Ellison Photography', 'photographer', 'https://maraellison.example', 'studio@maraellison.example', '(214) 555-0156', '915 Cedar Springs Yard', 'Dallas', 'TX', '75204', null,
    'Our first call for headshots, lookbooks and teen tests. Studio in Uptown; books up three weeks ahead.', true, 1100),
  (8, 'Tobias Venn Studio', 'photographer', 'https://tobiasvenn.example', 'tobias@tobiasvenn.example', '(214) 555-0157', '3100 Foundry Lane, Unit 4', 'Dallas', 'TX', '75226', null,
    'Editorial and menswear. Shoots most Verve & Thread stories. Happy to test with development faces in slow weeks.', true, 760),
  (9, 'Kestrel Model Management', 'agency', 'https://kestrel-models.example', 'placements@kestrel-models.example', '(212) 555-0161', '212 Wexford Street, Floor 4', 'New York', 'NY', '10012', 'accounts@kestrel-models.example',
    'New York partner agency. We remain mother agency on shared talent; commissions are settled quarterly.', true, 1000),
  (10, 'Trinity Bridal Collective', 'client', 'https://trinitybridal.example', 'shows@trinitybridal.example', '(214) 555-0158', '500 Market Hall Plaza', 'Dallas', 'TX', '75207', 'office@trinitybridal.example',
    'Runs the spring and fall bridal market shows. Books ten to fourteen models per show; fittings the week before.', true, 950),
  (11, 'Summit Mile Athletics', 'brand', 'https://summitmile.example', 'brand@summitmile.example', '(817) 555-0159', '6200 Clearfork Trail', 'Fort Worth', 'TX', '76109', 'ap@summitmile.example',
    'Activewear and running brand. Wants athletic talent who can actually run: early call times, real mileage.', true, 330),
  (12, 'Verve & Thread', 'other', 'https://verveandthread.example', 'editors@verveandthread.example', '(214) 555-0160', '77 Print Works Alley', 'Dallas', 'TX', '75202', null,
    'Independent fashion quarterly. Editorial rates only, but strong tear sheets and good relationships with the photographers we use.', true, 480),
  (13, 'Marigold Home', 'brand', 'https://marigoldhome.example', 'studio@marigoldhome.example', '(817) 555-0167', '1812 Camp Bowie Arcade', 'Fort Worth', 'TX', '76107', 'accounts@marigoldhome.example',
    'Homeware brand. Lifestyle catalog twice a year; budgets are tight and dates move.', true, 150),
  (14, 'Paloma Swim', 'brand', null, 'hello@palomaswim.example', '(512) 555-0168', '36 Rainey Dock', 'Austin', 'TX', '78701', null,
    'Closed last year. Kept for past bookings and usage records.', false, 800)
) as v(n, name, kind, website, email, phone, address_1, city, state, postal_code, billing_email, notes, is_active, days_ago);

insert into public.company_contacts (id, company_id, name, title, email, phone, notes, is_primary)
select demo_seed.id('c1', v.k), demo_seed.id('c0', v.n), v.name, v.title, v.email, v.phone, v.notes, v.is_primary
from (values
  (1, 1, 'Meredith Calloway', 'Creative Director', 'meredith.calloway@haldenrowe.example', '(214) 555-0175', 'Final say on casting. Likes two options per look.', true),
  (2, 1, 'Jorge Santana', 'Studio Producer', 'jorge.santana@haldenrowe.example', '(214) 555-0176', 'Sends call sheets. Text for day-of changes.', false),
  (3, 2, 'Solene Marchand', 'Founder and Designer', 'solene@soleneatelier.example', '(214) 555-0177', 'Chooses every face herself.', true),
  (4, 2, 'Beatrix Lowe', 'Showroom Manager', 'beatrix.lowe@soleneatelier.example', '(214) 555-0178', 'Runs fittings and showroom days.', false),
  (5, 3, 'Wyatt Garrison', 'Brand Manager', 'wyatt.garrison@bluebonnetdenim.example', '(512) 555-0179', null, true),
  (6, 3, 'Ines Navarro', 'Accounts Payable', 'ines.navarro@bluebonnetdenim.example', '(512) 555-0180', 'Send invoice reminders here, not to Wyatt.', false),
  (7, 4, 'Priscilla Okafor-Lane', 'Head of Marketing', 'priscilla@lumeraskin.example', '(469) 555-0181', null, true),
  (8, 5, 'Dana Marlowe', 'Casting Director', 'dana@marlowecasting.example', '(214) 555-0182', 'Prefers self-tapes for first rounds.', true),
  (9, 5, 'Felix Arroyo', 'Casting Associate', 'felix@marlowecasting.example', '(214) 555-0183', 'Schedules sessions and sends sides.', false),
  (10, 6, 'Carla Whitmore', 'Executive Producer', 'carla.whitmore@ironwoodproductions.example', '(512) 555-0184', null, true),
  (11, 6, 'Desmond Yates', 'Production Coordinator', 'desmond.yates@ironwoodproductions.example', '(512) 555-0185', 'Paperwork, parking and minors'' permits.', false),
  (12, 7, 'Mara Ellison', 'Photographer', 'mara@maraellison.example', '(214) 555-0156', null, true),
  (13, 7, 'Josie Tran', 'Studio Manager', 'josie@maraellison.example', '(214) 555-0186', 'Books the calendar.', false),
  (14, 8, 'Tobias Venn', 'Photographer', 'tobias@tobiasvenn.example', '(214) 555-0157', null, true),
  (15, 9, 'Ingrid Solberg', 'Placement Agent', 'ingrid.solberg@kestrel-models.example', '(212) 555-0161', 'Our contact for Amara, Julian and development placements.', true),
  (16, 10, 'Vivian Ashcroft', 'Show Producer', 'vivian.ashcroft@trinitybridal.example', '(214) 555-0187', 'Confirms the lineup two weeks before each market.', true),
  (17, 11, 'Reggie Malone', 'Brand Director', 'reggie.malone@summitmile.example', '(817) 555-0188', null, true),
  (18, 11, 'Hye-won Shin', 'Art Buyer', 'hyewon.shin@summitmile.example', '(817) 555-0189', 'Handles usage and options.', false),
  (19, 12, 'Odalys Finch', 'Fashion Editor', 'odalys.finch@verveandthread.example', '(214) 555-0190', null, true),
  (20, 13, 'Peter Lindqvist-Shaw', 'Marketing Manager', 'peter@marigoldhome.example', '(817) 555-0191', null, true),
  (21, 14, 'Paloma Estrada', 'Founder', 'paloma@palomaswim.example', '(512) 555-0168', 'Company closed; she may launch a new label.', true)
) as v(k, n, name, title, email, phone, notes, is_primary);

-- ===========================================================================
-- 10. Bookings
-- ===========================================================================
-- Past jobs, this week and the next six weeks. Inserted in date order so the
-- BK-000NN references ascend. Bookings 14 and 15 overlap for Amara Cole on
-- purpose: the booking page shows the double-booking warning.
insert into public.bookings (id, title, booking_type, status, company_id, contact_id, start_at, end_at, all_day, location, usage_terms, notes, created_at)
select demo_seed.id('b0', v.n), v.title, v.booking_type, v.status, demo_seed.id('c0', v.company), demo_seed.id('c1', v.contact),
  demo_seed.at(v.day, v.starts), demo_seed.at(v.day, v.ends), v.all_day, v.location, v.usage_terms, v.notes, demo_seed.ago(v.created_days)
from (values
  (1, 'Halden & Rowe Holiday Lookbook', 'shoot', 'completed', 1, 1, -52, '08:00', '17:00', false, 'Halden & Rowe Photo Studio, 1400 Commerce Row, Dallas',
    'Print catalog, in-store and digital. Six months, United States.', 'Thirty-two looks across three models. Hair and makeup at 7:30.', 70),
  (2, 'Solene Atelier Resort Campaign', 'campaign', 'completed', 2, 3, -45, '07:00', '18:00', false, 'Lake Whitlow Boathouse, Granbury, TX',
    'Digital, social and wholesale lookbook. Twelve months, worldwide. Womenswear exclusivity for the term.', 'Location day. Van leaves the agency at 5:30 am.', 64),
  (3, 'Bluebonnet Denim Fall E-commerce', 'shoot', 'completed', 3, 5, -38, '09:00', '18:00', false, 'Bluebonnet Denim Studio, 410 Tannery Yard, Austin',
    'Website and paid social. Six months, North America.', 'Up to sixty looks per model.', 55),
  (4, 'Trinity Bridal Collective Fall Market Show', 'show', 'completed', 10, 16, -30, '15:00', '21:30', false, 'Trinity Market Hall, 500 Market Hall Plaza, Dallas',
    'Runway only. Show images for trade press and the organizer''s channels.', 'Call 3 pm, show at 7 pm. Fittings were held the week before.', 50),
  (5, 'Lumera Skin Social Content Day', 'shoot', 'completed', 4, 7, -24, '09:00', '15:00', false, 'Studio B, 3100 Foundry Lane, Dallas',
    'Organic and paid social. Ninety days. Skincare exclusivity for the term.', 'Clean skin on arrival; no retinol the week before.', 36),
  (6, 'Halden & Rowe Teen Holiday Catalog', 'shoot', 'completed', 1, 2, -20, '16:00', '19:30', false, 'Halden & Rowe Photo Studio, 1400 Commerce Row, Dallas',
    'Print catalog and in-store. Three months, United States.', 'After-school call. A guardian stays on set for each teen.', 34),
  (7, 'Verve & Thread Editorial: Blue Hour', 'shoot', 'completed', 12, 19, -17, '15:00', '21:00', false, 'Rooftop of the Alder Building, downtown Dallas',
    'Editorial, one issue plus the magazine''s own channels.', 'Photographer: Tobias Venn. Tear sheets promised within six weeks.', 30),
  (8, 'Summit Mile Athletics Spring Catalog', 'shoot', 'completed', 11, 17, -12, '06:30', '15:00', false, 'White Rock trailhead, then Summit Mile studio, Fort Worth',
    'Print and digital catalog. Six months, United States.', 'Sunrise running shots first: models should arrive warmed up.', 28),
  (9, 'Halden & Rowe Fit Session', 'fitting', 'cancelled', 1, 2, -9, '10:00', '12:00', false, 'Halden & Rowe buying office, Dallas',
    null, 'Cancelled by the client the day before (samples delayed). Half fee applies.', 16),
  (10, 'Ironwood Productions: Regional Bank Commercial', 'shoot', 'completed', 6, 10, -5, '07:00', '19:00', false, 'Soundstage 2, Ironwood Productions, Austin',
    'Regional television and streaming, thirteen weeks. Banking exclusivity for the term.', 'Three principals. Wardrobe sent sizes ahead; see call sheet.', 26),
  (11, 'Solene Atelier Showroom Fittings', 'fitting', 'confirmed', 2, 4, 0, '13:00', '17:00', false, 'Solene Atelier, 88 Dragon Mill Street, Studio 5, Dallas',
    null, 'Fall collection fittings. Bring nude seamless and a strapless bra.', 8),
  (12, 'Marlowe Casting: Streaming Series Day Players', 'casting', 'confirmed', 5, 8, 1, '10:00', '14:00', false, 'Marlowe Casting, 2200 Elm Hollow, Suite B, Dallas',
    null, 'Sides sent by Felix. Time slots: Theo 10:00, Anika 10:40, River 11:20.', 5),
  (13, 'Travel to Austin for the Bluebonnet Denim campaign', 'travel', 'confirmed', 3, 5, 1, '00:00', '23:59', true, 'Dallas and Houston to Dripping Springs, TX',
    null, 'Client has booked two rooms at the ranch. Mileage and per diem billed with the campaign.', 7),
  (14, 'Bluebonnet Denim Spring Campaign', 'campaign', 'confirmed', 3, 5, 2, '08:00', '18:00', false, 'Barton Ranch, Dripping Springs, TX',
    'Digital, print and out-of-home. Twelve months, North America. Denim exclusivity for the term.', 'Location campaign. Boots provided; bring your own broken-in pair as a backup.', 21),
  (15, 'Lumera Skin Product Launch Event', 'event', 'option', 4, 7, 2, '16:00', '21:00', false, 'The Conservatory at Pearl Street, Dallas',
    'Event appearance. Photos for the brand''s social channels, thirty days.', 'First option. Client asked for Amara, who is confirmed in Dripping Springs the same day: offer Imani or Noor only.', 3),
  (16, 'Halden & Rowe Spring Preview Lookbook', 'shoot', 'option', 1, 1, 4, '08:00', '17:00', false, 'Halden & Rowe Photo Studio, 1400 Commerce Row, Dallas',
    'Print catalog, in-store and digital. Six months, United States.', 'Options sent in the Spring Preview package.', 12),
  (17, 'Marigold Home Spring Catalog', 'shoot', 'cancelled', 13, 20, 6, '09:00', '16:00', false, 'Marigold Home showroom, Fort Worth',
    null, 'Client postponed to next quarter; no fee. They will come back with new dates.', 15),
  (18, 'Trinity Bridal Collective Spring Market Show', 'show', 'confirmed', 10, 16, 9, '14:00', '21:00', false, 'Trinity Market Hall, 500 Market Hall Plaza, Dallas',
    'Runway only. Show images for trade press and the organizer''s channels.', 'Sienna opens. Fittings two days before: see appointments.', 19),
  (19, 'Summit Mile Athletics Run Club Campaign', 'campaign', 'option', 11, 17, 18, '06:00', '14:00', false, 'Trinity Trails, Fort Worth',
    'Digital and out-of-home. Twelve months, United States.', 'Second option. Casting this week; dates may move by a day.', 6),
  (20, 'Verve & Thread Editorial: Open Road', 'shoot', 'option', 12, 19, 25, '09:00', '19:00', false, 'Highway location near Marfa, TX',
    'Editorial, one issue plus the magazine''s own channels.', 'Travel day before. Editorial rate; the magazine covers flights and hotel.', 5),
  (21, 'Ironwood Productions: Hospital System Commercial', 'shoot', 'option', 6, 10, 33, '07:00', '18:00', false, 'St. Elara Medical Pavilion (location), Round Rock, TX',
    'Regional television and streaming, thirteen weeks. Healthcare exclusivity for the term.', 'First refusal on all three. Ethan needs a guardian and a current work permit on set.', 4),
  (22, 'Solene Atelier Fall Collection Lookbook', 'shoot', 'confirmed', 2, 3, 41, '08:00', '18:00', false, 'Solene Atelier, 88 Dragon Mill Street, Studio 5, Dallas',
    'Digital, social and wholesale lookbook. Twelve months, worldwide.', 'Confirmed after the showroom casting. Photographer: Lena Marchetti.', 10)
) as v(n, title, booking_type, status, company, contact, day, starts, ends, all_day, location, usage_terms, notes, created_days)
order by v.day, v.n;

insert into public.booking_talent (booking_id, talent_id, role)
select demo_seed.id('b0', v.b), demo_seed.t(v.t), v.role
from (values
  (1, 1, 'Model'), (1, 3, 'Model'), (1, 2, 'Model'),
  (2, 1, 'Lead'), (2, 11, 'Model'),
  (3, 4, 'Model'), (3, 13, 'Model'),
  (4, 3, 'Opening look'), (4, 5, 'Model'), (4, 6, 'Model'), (4, 11, 'Model'),
  (5, 5, 'Lead'), (5, 12, 'Model'),
  (6, 8, 'Model'), (6, 10, 'Model'),
  (7, 2, 'Model'), (7, 1, 'Model'),
  (8, 7, 'Model'), (8, 19, 'Lead'), (8, 16, 'Model'),
  (9, 6, 'Fit model'),
  (10, 14, 'Principal'), (10, 18, 'Principal'), (10, 12, 'Principal'),
  (11, 1, 'Fit model'), (11, 3, 'Fit model'),
  (12, 13, 'Audition'), (12, 15, 'Audition'), (12, 17, 'Audition'),
  (13, 4, null), (13, 1, null),
  (14, 4, 'Lead'), (14, 1, 'Lead'),
  (15, 1, 'Brand host'), (15, 5, 'Brand host'),
  (16, 3, 'Model'), (16, 11, 'Model'), (16, 2, 'Model'),
  (17, 12, 'Model'),
  (18, 3, 'Opening look'), (18, 5, 'Model'), (18, 6, 'Model'), (18, 16, 'Model'), (18, 11, 'Model'),
  (19, 7, 'Model'), (19, 19, 'Lead'),
  (20, 1, 'Model'), (20, 13, 'Model'),
  (21, 18, 'Principal'), (21, 14, 'Principal'), (21, 9, 'Featured'),
  (22, 1, 'Lead'), (22, 3, 'Model'), (22, 5, 'Model')
) as v(b, t, role);

-- Fees, invoices and payouts (finance permissions; audited without amounts).
select demo_seed.act_as('henry');
insert into public.booking_financials (booking_id, rate_type, fee_total, currency, commission_pct, expenses, invoice_status, invoice_number, invoiced_on, paid_on, notes)
select demo_seed.id('b0', v.b), v.rate_type, v.fee_total, 'USD', v.commission, v.expenses, v.invoice_status, v.invoice_number,
  demo_seed.today() - v.invoiced_ago, demo_seed.today() - v.paid_ago, v.notes
from (values
  (1, 'day', 6400, 20, 180, 'paid', 'INV-2031', 45, 20, 'Paid in full. Expenses: parking and a courier.'),
  (2, 'day', 5200, 20, 640, 'paid', 'INV-2034', 40, 12, 'Includes van hire and location permit.'),
  (3, 'day', 3800, 20, 0, 'invoiced', 'INV-2038', 33, null, 'Past due. Reminder sent to Ines Navarro; second reminder due this week.'),
  (4, 'flat', 3400, 20, 0, 'paid', 'INV-2041', 27, 8, null),
  (5, 'half_day', 2900, 20, 120, 'invoiced', 'INV-2044', 20, null, 'Net 30.'),
  (6, 'half_day', 1400, 20, 0, 'paid', 'INV-2045', 18, 4, 'Fifteen percent of each teen''s fee goes to the custodial account.'),
  (7, 'flat', 650, 20, 0, 'written_off', null, null, null, 'Editorial rate waived in exchange for tear sheets and the cover try.'),
  (8, 'day', 5100, 20, 310, 'not_invoiced', null, null, null, 'Waiting for the client to confirm final usage before invoicing.'),
  (9, 'hourly', 85, 20, 0, 'invoiced', 'INV-2049', 8, null, 'Cancellation fee: half of the two-hour minimum.'),
  (10, 'day', 4800, 15, 220, 'invoiced', 'INV-2052', 3, null, 'Commercial rate; usage invoiced with the session.'),
  (11, 'hourly', 510, 20, 0, 'not_invoiced', null, null, null, 'Three hours each at the fitting rate.'),
  (12, 'tbc', null, 20, null, 'not_invoiced', null, null, null, 'Casting: no fee. Rates on booking.'),
  (13, 'flat', 400, 0, 260, 'not_invoiced', null, null, null, 'Travel day. Billed on the campaign invoice.'),
  (14, 'day', 4700, 20, 0, 'not_invoiced', null, null, null, 'Usage included for twelve months.'),
  (15, 'flat', 1800, 20, 0, 'not_invoiced', null, null, null, 'Quote sent; not yet accepted.'),
  (16, 'day', 6000, 20, 0, 'not_invoiced', null, null, null, null),
  (18, 'flat', 4250, 20, 0, 'not_invoiced', null, null, null, 'Fittings billed hourly on the same invoice.'),
  (19, 'tbc', null, 20, null, 'not_invoiced', null, null, null, 'Budget not confirmed.'),
  (20, 'flat', 700, 20, 0, 'not_invoiced', null, null, null, 'Editorial rate.'),
  (21, 'day', 4800, 15, 0, 'not_invoiced', null, null, null, null),
  (22, 'day', 6900, 20, 0, 'not_invoiced', null, null, null, null)
) as v(b, rate_type, fee_total, commission, expenses, invoice_status, invoice_number, invoiced_ago, paid_ago, notes);

insert into public.booking_talent_fees (booking_id, talent_id, fee, paid_to_talent_on)
select demo_seed.id('b0', v.b), demo_seed.t(v.t), v.fee, demo_seed.today() - v.paid_ago
from (values
  (1, 1, 2500, 14), (1, 3, 2000, 14), (1, 2, 1900, 14),
  (2, 1, 2800, 8), (2, 11, 2400, 8),
  (3, 4, 2000, null), (3, 13, 1800, null),
  (4, 3, 900, 5), (4, 5, 800, 5), (4, 6, 900, 5), (4, 11, 800, 5),
  (5, 5, 1500, null), (5, 12, 1400, null),
  (6, 8, 700, 2), (6, 10, 700, 2),
  (7, 2, 300, null), (7, 1, 350, null),
  (8, 7, 1500, null), (8, 19, 1900, null), (8, 16, 1700, null),
  (9, 6, 85, null),
  (10, 14, 1600, null), (10, 18, 1600, null), (10, 12, 1600, null),
  (11, 1, 255, null), (11, 3, 255, null),
  (13, 4, 200, null), (13, 1, 200, null),
  (14, 4, 2200, null), (14, 1, 2500, null),
  (15, 1, 1000, null), (15, 5, 800, null),
  (16, 3, 2000, null), (16, 11, 2000, null), (16, 2, 2000, null),
  (18, 3, 900, null), (18, 5, 800, null), (18, 6, 900, null), (18, 16, 850, null), (18, 11, 800, null),
  (20, 1, 350, null), (20, 13, 350, null),
  (21, 18, 1600, null), (21, 14, 1600, null), (21, 9, 1600, null),
  (22, 1, 2500, null), (22, 3, 2200, null), (22, 5, 2200, null)
) as v(b, t, fee, paid_ago);

-- Castings, fittings, go-sees and test shoots. None of them overlaps a booking
-- for the same person, so the only conflict warning is the deliberate one.
select demo_seed.act_as('priya');
insert into public.talent_appointments (talent_id, event_type, job_type, client, product, start_at, end_at, status, notes, cancelled, booker, board, booking_id, created_at)
select demo_seed.t(v.t), v.event_type, v.job_type, v.client, v.product, demo_seed.at(v.day, v.starts), demo_seed.at(v.day, v.ends), v.status, v.notes, v.cancelled,
  'Priya Nair', v.board, case when v.booking is not null then demo_seed.id('b0', v.booking) end, demo_seed.ago(greatest(1, 6 - v.day))
from (values
  (2, 'Fitting', 'Lookbook', 'Halden & Rowe', 'Holiday lookbook', -54, '15:00', '16:00', 'completed', null, false, 'Men / Fashion', null),
  (7, 'Test shoot', 'Development', 'Idris Okonjo', 'Streetwear test', -35, '16:00', '19:00', 'completed', 'Images delivered; four selected for the book.', false, 'Men / Development', null),
  (5, 'Go-see', 'Beauty', 'Lumera Skin', 'Social content day', -29, '14:00', '14:30', 'completed', 'Booked on the spot.', false, 'Women / Fashion', null),
  (16, 'Casting', 'Catalog', 'Summit Mile Athletics', 'Spring catalog', -19, '11:00', '11:30', 'cancelled', 'Client cast from digitals instead; Camille was booked anyway.', true, 'Women / Curve', null),
  (1, 'Casting', 'Lookbook', 'Solene Atelier', 'Fall collection', -14, '11:00', '11:45', 'completed', 'Confirmed for the fall lookbook.', false, 'Women / Fashion', null),
  (10, 'Casting', 'Commercial', 'Marlowe Casting', 'Sporting goods spot', -7, '16:30', '17:00', 'completed', 'Good read; no booking this time.', false, 'Teens / Boys', null),
  (12, 'Casting', 'Commercial', 'Ironwood Productions', 'Hospital system commercial', -3, '13:00', '13:30', 'completed', 'On first refusal.', false, 'Women / Commercial', null),
  (13, 'Casting', 'Series', 'Marlowe Casting', 'Streaming series day players', 1, '10:00', '10:40', 'confirmed', 'Sides attached to the booking.', false, 'Men / Fashion', 12),
  (6, 'Meeting', 'Agency', '42 Model Management', 'Book review with Sofia', 2, '11:00', '12:00', 'confirmed', 'Choose new swim images for the comp card.', false, 'Women / Curve', null),
  (7, 'Casting', 'Campaign', 'Summit Mile Athletics', 'Run club campaign', 3, '10:30', '11:15', 'scheduled', 'Bring running shoes; they will film a short jog.', false, 'Men / Development', null),
  (19, 'Casting', 'Campaign', 'Summit Mile Athletics', 'Run club campaign', 3, '11:15', '12:00', 'scheduled', null, false, 'Men / Commercial', null),
  (8, 'Casting', 'Commercial', 'Marlowe Casting', 'Regional grocery spot', 4, '16:30', '17:15', 'confirmed', 'Laura attending. After school.', false, 'Teens / Girls', null),
  (9, 'Casting', 'Commercial', 'Marlowe Casting', 'Regional grocery spot', 4, '17:15', '18:00', 'confirmed', 'David attending.', false, 'Teens / Boys', null),
  (1, 'Fitting', 'Lookbook', 'Solene Atelier', 'Fall collection, second fitting', 5, '14:00', '15:30', 'confirmed', null, false, 'Women / Fashion', null),
  (15, 'Test shoot', 'Development', 'Carys Whitlow', 'Beauty test', 6, '09:00', '12:00', 'confirmed', 'Clean face, hair washed the night before.', false, 'Women / Development', null),
  (3, 'Fitting', 'Runway', 'Trinity Bridal Collective', 'Spring market show', 7, '11:00', '13:00', 'confirmed', 'Opening and closing looks.', false, 'Women / Fashion', null),
  (5, 'Fitting', 'Runway', 'Trinity Bridal Collective', 'Spring market show', 7, '13:00', '14:30', 'confirmed', null, false, 'Women / Fashion', null),
  (2, 'Go-see', 'E-commerce', 'Bluebonnet Denim Co.', 'Spring denim', 8, '15:00', '15:45', 'scheduled', null, false, 'Men / Fashion', null),
  (11, 'Go-see', 'Beauty', 'Lumera Skin', 'Ambassador search', 10, '13:00', '13:45', 'scheduled', 'They liked her polaroids; meeting the founder.', false, 'Women / Fashion', null),
  (1, 'Casting', 'Editorial', 'Verve & Thread', 'Open Road story', 11, '10:00', '10:45', 'scheduled', null, false, 'Women / Fashion', null),
  (20, 'Test shoot', 'Development', 'Mara Ellison Photography', 'Second test', 12, '16:00', '18:00', 'tentative', 'Only if the guardian consent form is back.', false, 'Teens / Girls', null),
  (4, 'Meeting', 'Legal', 'Ruiz & Tate', 'Visa renewal check-in', 13, '09:30', '10:15', 'scheduled', 'Call with his attorney; Henry to join.', false, 'Men / Fashion', null),
  (21, 'Test shoot', 'Development', 'Tobias Venn Studio', 'First test', 16, '10:00', '13:00', 'scheduled', null, false, null, null),
  (3, 'Go-see', 'Showroom', 'Atelier Nord Models', 'Paris showroom season (video call)', 20, '08:00', '08:45', 'scheduled', 'Early because of the time difference.', false, 'Women / Fashion', null)
) as v(t, event_type, job_type, client, product, day, starts, ends, status, notes, cancelled, board, booking);

-- Usage records: where each campaign may run, and for how long.
insert into public.talent_usages (talent_id, event_type, usage_type, client, product, start_date, end_date, booker, exclusivity, board, notes, booking_id)
select demo_seed.t(v.t), v.event_type, v.usage_type, v.client, v.product, demo_seed.today() + v.starts, demo_seed.today() + v.ends, 'Priya Nair', v.exclusivity, null, v.notes,
  case when v.booking is not null then demo_seed.id('b0', v.booking) end
from (values
  (1, 'Lookbook', 'Print catalog, in-store and digital', 'Halden & Rowe', 'Holiday lookbook', -52, 130, 'None', null, 1),
  (3, 'Lookbook', 'Print catalog, in-store and digital', 'Halden & Rowe', 'Holiday lookbook', -52, 130, 'None', null, 1),
  (2, 'Lookbook', 'Print catalog, in-store and digital', 'Halden & Rowe', 'Holiday lookbook', -52, 130, 'None', null, 1),
  (1, 'Campaign', 'Digital, social and wholesale lookbook, worldwide', 'Solene Atelier', 'Resort collection', -45, 320, 'Contemporary womenswear, twelve months', 'Check with Solene before accepting competing designer campaigns.', 2),
  (11, 'Campaign', 'Digital, social and wholesale lookbook, worldwide', 'Solene Atelier', 'Resort collection', -45, 320, 'None', null, 2),
  (4, 'E-commerce', 'Website and paid social, North America', 'Bluebonnet Denim Co.', 'Fall denim', -38, 325, 'Denim, for the term', 'Extended six months; extension fee invoiced separately.', 3),
  (13, 'E-commerce', 'Website and paid social, North America', 'Bluebonnet Denim Co.', 'Fall denim', -38, 145, 'None', null, 3),
  (5, 'Social content', 'Organic and paid social', 'Lumera Skin', 'Daily Glow serum', -24, 66, 'Skincare, ninety days', null, 5),
  (12, 'Social content', 'Organic and paid social', 'Lumera Skin', 'Daily Glow serum', -24, 66, 'None', null, 5),
  (8, 'Catalog', 'Print catalog and in-store', 'Halden & Rowe', 'Teen holiday catalog', -20, 70, 'None', null, 6),
  (10, 'Catalog', 'Print catalog and in-store', 'Halden & Rowe', 'Teen holiday catalog', -20, 70, 'None', null, 6),
  (7, 'Catalog', 'Print and digital catalog', 'Summit Mile Athletics', 'Spring catalog', -12, 170, 'None', null, 8),
  (19, 'Catalog', 'Print and digital catalog', 'Summit Mile Athletics', 'Spring catalog', -12, 170, 'Running footwear, six months', null, 8),
  (16, 'Catalog', 'Print and digital catalog', 'Summit Mile Athletics', 'Spring catalog', -12, 170, 'None', null, 8),
  (14, 'Broadcast', 'Regional television and streaming, thirteen weeks', 'Ironwood Productions', 'Redbud Community Bank', -5, 86, 'Banking and financial services, thirteen weeks', null, 10),
  (18, 'Broadcast', 'Regional television and streaming, thirteen weeks', 'Ironwood Productions', 'Redbud Community Bank', -5, 86, 'Banking and financial services, thirteen weeks', null, 10),
  (12, 'Broadcast', 'Regional television and streaming, thirteen weeks', 'Ironwood Productions', 'Redbud Community Bank', -5, 86, 'Banking and financial services, thirteen weeks', null, 10),
  (2, 'Campaign', 'Digital, print and out-of-home', 'Bluebonnet Denim Co.', 'Fall campaign', -345, 20, 'Denim, twelve months', 'Expires soon: ask Wyatt about renewal before the spring campaign runs.', null),
  (6, 'Campaign', 'Digital and print', 'Paloma Swim', 'Summer collection', -400, -35, 'Swimwear (expired)', 'Brand has closed; images should be down.', null)
) as v(t, event_type, usage_type, client, product, starts, ends, exclusivity, notes, booking);

-- ===========================================================================
-- 11. Tasks
-- ===========================================================================
insert into public.tasks (id, title, notes, status, priority, due_on, assignee_id, related_type, related_id, completed_at, created_by, created_at)
select demo_seed.id('e5', v.n), v.title, v.notes, v.status, v.priority, demo_seed.today() + v.due_in, demo_seed.id('d0', v.assignee), v.related_type,
  case v.related_type when 'talent' then demo_seed.t(v.related) when 'booking' then demo_seed.id('b0', v.related)
    when 'company' then demo_seed.id('c0', v.related) when 'application' then demo_seed.id('a1', v.related) end,
  case when v.status = 'done' then demo_seed.ago(v.done_ago) end, demo_seed.id('d0', v.author), demo_seed.ago(v.created_ago)
from (values
  (1, 'Send Sienna Brooks her contract renewal', 'Three-year renewal drafted (see Documents). Needs Olivia''s signature before it goes out.', 'open', 'high', 3, 1, 'talent', 3, null, 4, 10),
  (2, 'Chase Bluebonnet Denim for INV-2038', 'Past due. Email Ines Navarro in accounts payable, copy Wyatt only if there is no reply by Friday.', 'open', 'high', -3, 6, 'booking', 3, null, 6, 9),
  (3, 'Invoice Summit Mile Athletics for the spring catalog', 'Waiting on the usage confirmation from Hye-won. Invoice as soon as it lands.', 'open', 'normal', 0, 6, 'booking', 8, null, 3, 6),
  (4, 'Confirm call times for the Solene Atelier showroom fittings', 'Amara 1 pm, Sienna 2:30 pm. Call sheet shared with both.', 'done', 'normal', -1, 3, 'booking', 11, 1.2, 3, 5),
  (5, 'Collect the guardian consent form for Ava Lindholm', 'Kristin has the form. Ava cannot be published or sent to castings until it is back.', 'open', 'high', -2, 4, 'talent', 20, null, 4, 12),
  (6, 'Renew Zoe Whitfield''s work permit', 'Expires in under a month. Laura has the renewal form; school signature required.', 'open', 'normal', 10, 4, 'talent', 8, null, 4, 14),
  (7, 'Follow up on Julian Reyes'' passport renewal', 'Needed for the London placement. He has an appointment booked.', 'open', 'normal', 7, 6, 'talent', 2, null, 6, 8),
  (8, 'Review this week''s Join Us applications', 'Four new since Monday, one of them a re-application from current talent.', 'open', 'normal', 0, 4, 'application', 1, null, 1, 2),
  (9, 'Update comp cards for the spring show package', 'New measurements for Kai and Ethan; swap Elise''s swim image.', 'open', 'low', 14, 5, null, null, null, 4, 7),
  (10, 'Retouch and upload the Blue Hour editorial images', 'Verve & Thread released the selects. Add to Amara''s and Julian''s editorial books.', 'open', 'normal', 2, 5, 'talent', 1, null, 4, 4),
  (11, 'Resolve the double booking for Amara Cole', 'Lumera Skin want her for the launch event on the Bluebonnet campaign day. Offer Imani or Noor and release the option.', 'open', 'high', 1, 3, 'booking', 15, null, 3, 3),
  (12, 'Send the Spring Preview options package to Halden & Rowe', 'Five options for Meredith. Link expires after two weeks.', 'done', 'normal', -18, 3, 'company', 1, 20, 3, 22),
  (13, 'Renewal call with Hannah Weiss', 'Her contract lapsed last week while she was travelling. She is back on Monday.', 'open', 'normal', 5, 1, 'talent', 18, null, 1, 3),
  (14, 'Check Mateo Alvarez''s visa receipt notice', 'Do not confirm usage beyond the current expiry until the receipt notice is on file.', 'open', 'high', 12, 2, 'talent', 4, null, 6, 12),
  (15, 'Publish the updated Services page', 'New divisions copy approved by Olivia.', 'done', 'normal', -4, 2, null, null, 3, 1, 9),
  (16, 'Schedule Mila Novak''s first test shoot', 'Tobias has a slot in two weeks. Confirm with Mila and add it to appointments.', 'done', 'normal', -1, 4, 'talent', 21, 1, 4, 11),
  (17, 'Prepare board changes for the quarterly roster review', 'Proposals: move Noor to the main board only; add Anika to Women / Fashion.', 'open', 'low', 21, 1, null, null, null, 1, 5),
  (18, 'Reconcile talent payments for last month', 'All vouchers matched; two custodial transfers confirmed.', 'done', 'normal', -10, 6, null, null, 9, 6, 20),
  (19, 'Proofread the new talent bios before the website refresh', 'Nineteen bios. Flag anything that reads like a sales pitch.', 'open', 'low', 6, 7, null, null, null, 2, 4),
  (20, 'Ask Kestrel for Amara''s spring casting dates', 'Ingrid mentioned two weeks in New York. Needed before we confirm anything after the lookbook.', 'open', 'normal', 8, 3, 'company', 9, null, 1, 6)
) as v(n, title, notes, status, priority, due_in, assignee, related_type, related, done_ago, author, created_ago);

-- ===========================================================================
-- 12. Packages (client shortlists)
-- ===========================================================================
-- Only the SHA-256 hash of a share token is stored, exactly like
-- src/features/packages/share.ts. The demo tokens are fixed so the links work:
--   /p/DEMOsoleneFallLookbookShortlist42mmSandbox01   live, expires in two weeks
--   /p/DEMOhaldenSpringPreviewOptions42mmSandbox02    expired three days ago
--   /p/DEMOlumeraLaunchFacesRevoked0042mmSandbox03    revoked
insert into public.packages (id, title, message, company_id, contact_id, show_measurements, created_at)
select demo_seed.id('c5', v.n), v.title, v.message, demo_seed.id('c0', v.company), demo_seed.id('c1', v.contact), v.show_measurements, demo_seed.ago(v.days_ago)
from (values
  (1, 'Solene Atelier: Fall Lookbook Shortlist', 'Hi Solene, here are five faces for the fall lookbook. Amara and Sienna you know; Noor, Imani and Anika are new to you and all available on your dates. Notes on each below. Happy to send digitals or arrange a go-see for anyone you would like to meet.', 2, 3, true, 16),
  (2, 'Halden & Rowe: Spring Preview Options', 'Meredith, first options for the Spring Preview lookbook. Two men, three women, all confirmed available for the shoot day and the fitting.', 1, 1, true, 22),
  (3, 'Lumera Skin: Launch Event Faces', 'Priscilla, four hosts for the launch evening. All are comfortable on camera and with guests.', 4, 7, false, 6),
  (4, 'Marlowe Casting: Teens for the Grocery Spot', 'Dana, three teens for the regional grocery spot. Guardians are available for all session times.', 5, 8, false, 2)
) as v(n, title, message, company, contact, show_measurements, days_ago);

insert into public.package_items (package_id, talent_id, sort_order, note)
select demo_seed.id('c5', v.p), demo_seed.t(v.t), v.position, v.note
from (values
  (1, 1, 1, 'Your resort campaign lead. Available both days.'),
  (1, 3, 2, 'Walked your showroom last season. Strong in the column silhouettes.'),
  (1, 5, 3, 'Great profile for the tailoring story. Available after 1 pm on the first day.'),
  (1, 11, 4, 'Beautiful movement; would suit the bias-cut dresses.'),
  (1, 15, 5, 'New face. A good fit if you want someone clients have not seen yet.'),
  (2, 3, 1, 'First option.'), (2, 11, 2, 'First option.'), (2, 2, 3, 'First option; back from New York the day before.'),
  (2, 13, 4, 'Second option for tailoring.'), (2, 4, 5, 'Second option; subject to his campaign travel.'),
  (3, 5, 1, 'Worked with you on the social content day.'), (3, 11, 2, null), (3, 6, 3, 'Experienced host; certified yoga instructor.'), (3, 16, 4, null),
  (4, 8, 1, 'Sixteen. Soccer player, great energy.'), (4, 9, 2, 'Fifteen. Relaxed and funny on camera.'), (4, 10, 3, 'Seventeen. Plays varsity basketball.')
) as v(p, t, position, note);

update public.packages set share_token_hash = encode(digest('DEMOhaldenSpringPreviewOptions42mmSandbox02', 'sha256'), 'hex'),
  shared_at = demo_seed.ago(20), expires_at = demo_seed.ago(3) where id = demo_seed.id('c5', 2);
update public.packages set share_token_hash = encode(digest('DEMOsoleneFallLookbookShortlist42mmSandbox01', 'sha256'), 'hex'),
  shared_at = demo_seed.ago(14), expires_at = now() + interval '14 days' where id = demo_seed.id('c5', 1);
update public.packages set share_token_hash = encode(digest('DEMOlumeraLaunchFacesRevoked0042mmSandbox03', 'sha256'), 'hex'),
  shared_at = demo_seed.ago(5), expires_at = now() + interval '9 days' where id = demo_seed.id('c5', 3);
-- Views recorded by the share page; then the Lumera link is withdrawn (the client
-- asked for Amara, who is not available that day).
update public.packages set view_count = 11, last_viewed_at = demo_seed.ago(4) where id = demo_seed.id('c5', 2);
update public.packages set view_count = 6, last_viewed_at = demo_seed.ago(0.4) where id = demo_seed.id('c5', 1);
update public.packages set view_count = 3, last_viewed_at = demo_seed.ago(3) where id = demo_seed.id('c5', 3);
update public.packages set revoked_at = demo_seed.ago(2) where id = demo_seed.id('c5', 3);

-- ===========================================================================
-- 13. Website (CMS)
-- ===========================================================================
-- Settings, navigation, pages and redirects. Pages are inserted as drafts and made
-- live through publish_website_page(), which snapshots a revision and audits it.
-- Image paths under cms/demo- are generated by the sandbox.
select demo_seed.act_as('marcus');

update public.website_settings s set value = v.value, updated_by = demo_seed.id('d0', 2)
from (values
  ('contact_email', to_jsonb('hello@northlight-demo.example'::text)),
  ('contact_phone', to_jsonb('(214) 555-0142'::text)),
  ('instagram_url', to_jsonb('https://instagram.example/42modelmanagement'::text)),
  ('location_line', to_jsonb('Dallas–Fort Worth · Texas'::text)),
  ('home_hero', jsonb_build_object('eyebrow', 'Independent talent / Dallas–Fort Worth', 'headline', 'The faces
of now.', 'text', 'Fashion, commercial, curve and teen talent, represented with care and booked by clients across Texas and beyond.',
    'image_path', 'cms/demo-home-hero.jpg')),
  ('home_about', jsonb_build_object('eyebrow', 'More than a roster', 'headline', 'People first.
Always.', 'text', 'From first digitals to national campaigns, we help talent build careers that last and give clients a roster with range, intention and staying power.',
    'image_path', 'cms/demo-home-about.jpg')),
  ('contact_heading', to_jsonb('Let''s make
something real.'::text))
) as v(key, value)
where s.key = v.key;

select public.write_audit('cms.settings_updated', 'website', null,
  jsonb_build_object('keys', jsonb_build_array('contact_email', 'contact_phone', 'instagram_url', 'location_line', 'home_hero', 'home_about')));

insert into public.website_navigation (location, label, href, sort_order, is_visible) values
  ('header', 'About', '/about', 1, true),
  ('header', 'Services', '/services', 2, true),
  ('header', 'Become a model', '/become-a-model', 3, true),
  ('header', 'Contact', '/contact', 4, true),
  ('header', 'Model Expo', '/model-expo', 5, false),
  ('footer', 'Services', '/services', 5, true),
  ('footer', 'Contact', '/contact', 6, true);

-- About: replaces the placeholder text the migration created.
update public.website_pages set
  title = 'About',
  seo_title = 'About 42 Model Management',
  meta_description = 'An independent model and talent agency in Dallas–Fort Worth representing fashion, commercial, curve and teen talent.',
  og_image_path = 'cms/demo-about-hero.jpg',
  sections = jsonb_build_array(
    jsonb_build_object('id', 'about-hero', 'type', 'hero', 'data', jsonb_build_object(
      'eyebrow', 'About the agency', 'heading', 'People first. Always.',
      'text', 'An independent agency in Dallas–Fort Worth, built on long relationships with the people we represent and the clients who book them.',
      'image_path', 'cms/demo-about-hero.jpg', 'cta_label', 'Meet the roster', 'cta_href', '/models', 'theme', 'dark')),
    jsonb_build_object('id', 'about-story', 'type', 'rich_text', 'data', jsonb_build_object('heading', 'Our story', 'body', $md$42 Model Management began with one desk, a borrowed studio and a simple idea: a model should always know who is looking after them.

Today we represent a deliberately small roster across fashion, commercial, curve and teen boards. Small means every booker knows every face, every client gets a straight answer, and nobody on our boards is a number.

We are based in the Dallas Design District and place talent with partner agencies in New York, Los Angeles, London, Paris and Milan.$md$)),
    jsonb_build_object('id', 'about-studio', 'type', 'image', 'data', jsonb_build_object(
      'image_path', 'cms/demo-about-studio.jpg', 'alt', 'The agency studio set up for a digitals day, with a white backdrop and daylight from tall windows',
      'caption', 'Digitals day at the studio. Every new signing starts here.', 'width', 'wide')),
    jsonb_build_object('id', 'about-values', 'type', 'rich_text', 'data', jsonb_build_object('heading', 'How we work', 'body', $md$- **Honest development.** We sign people we believe we can book, and we tell them the truth about what it will take.
- **Careful with minors.** Teens are represented with a parent or guardian on every booking. We never publish a minor's age, address or contact details.
- **Clear with clients.** Options, usage and fees are confirmed in writing before anyone travels.
- **Paid on time.** Talent statements go out monthly, with every voucher attached.$md$)),
    jsonb_build_object('id', 'about-boards', 'type', 'board_grid', 'data', jsonb_build_object('heading', 'Our boards')),
    jsonb_build_object('id', 'about-join', 'type', 'cta', 'data', jsonb_build_object(
      'heading', 'Want to be represented?', 'text', 'We review every application. Tell us about yourself and send three simple photos.',
      'label', 'Apply to join', 'href', '/join', 'theme', 'light')))
where slug = 'about';

insert into public.website_pages (id, slug, title, seo_title, meta_description, og_image_path, sections) values
  (demo_seed.id('ee', 1), 'services', 'Services', 'Services and divisions', 'Fashion, commercial, curve, teen and development divisions, plus casting support for brands and production companies.',
    'cms/demo-services-hero.jpg', jsonb_build_array(
    jsonb_build_object('id', 'services-hero', 'type', 'hero', 'data', jsonb_build_object(
      'eyebrow', 'Services', 'heading', 'One agency, every kind of booking.',
      'text', 'Campaigns, lookbooks, e-commerce, runway, broadcast and events. Tell us the brief and we will send options the same day.',
      'image_path', 'cms/demo-services-hero.jpg', 'cta_label', 'Start a booking', 'cta_href', '/contact', 'theme', 'dark')),
    jsonb_build_object('id', 'services-divisions', 'type', 'rich_text', 'data', jsonb_build_object('heading', 'Divisions', 'body', $md$## Fashion
Women and men for campaigns, editorial, lookbooks, showroom and runway. Our main boards travel, and many are placed with partner agencies in New York and Europe.

## Commercial
Real, relatable faces for retail, healthcare, finance, automotive and broadcast. Many of our commercial talent are experienced on-camera performers and voice artists.

## Curve
Curve talent for fashion, swim, lingerie, activewear and lifestyle clients.

## Teens
Teens from 13 to 17 for catalog, commercial and lifestyle work. A parent or guardian attends every booking, and work permits are kept current.

## Development
New signings in their first year. Ideal for test shoots, e-commerce and brands who want a face nobody has seen yet.$md$)),
    jsonb_build_object('id', 'services-featured', 'type', 'talent_grid', 'data', jsonb_build_object(
      'heading', 'Featured talent', 'featured_only', true, 'limit', 8, 'sort', 'featured', 'show_link', true)),
    jsonb_build_object('id', 'services-clients', 'type', 'rich_text', 'data', jsonb_build_object('heading', 'For clients', 'body', $md$**Packages.** We send a private link with the talent we recommend for your brief, with current measurements and recent work. No sign-in needed.

**Options and confirmations.** First and second options are held in writing. A confirmation includes the call time, location, rate and usage.

**Usage.** Every quote states where the images may run and for how long. Extensions are simple to arrange.

**Castings.** We can host castings at our studio, or send self-tapes and digitals within a day.$md$)),
    jsonb_build_object('id', 'services-set', 'type', 'image', 'data', jsonb_build_object(
      'image_path', 'cms/demo-services-set.jpg', 'alt', 'A photographer and crew on a location set at golden hour',
      'caption', 'On location for a spring campaign.', 'width', 'full')),
    jsonb_build_object('id', 'services-cta', 'type', 'cta', 'data', jsonb_build_object(
      'heading', 'Planning a shoot?', 'text', 'Send us your dates, usage and budget. A booker will reply with options within one working day.',
      'label', 'Get in touch', 'href', '/contact', 'theme', 'dark')))),
  (demo_seed.id('ee', 2), 'contact', 'Contact', 'Contact 42 Model Management', 'Bookings, new faces and press: how to reach the agency in Dallas–Fort Worth.',
    null, jsonb_build_array(
    jsonb_build_object('id', 'contact-details', 'type', 'contact', 'data', jsonb_build_object(
      'heading', 'Get in touch', 'text', 'Bookers are at their desks Monday to Friday, 9 am to 6 pm Central. For same-day changes on a booking, call the number on your call sheet.')),
    jsonb_build_object('id', 'contact-who', 'type', 'rich_text', 'data', jsonb_build_object('heading', 'Who to ask for', 'body', $md$## Bookings and options
Send dates, usage and budget to the bookings desk. You will have options the same day.

## New faces
We do not accept walk-ins. Please apply through the form so we can look at your photos properly.

## Partner agencies
Placement enquiries are welcome. Tell us which market and season you are casting for.

## Visit
2718 Dragon Mill Street, Suite 200, Dallas, TX 75207. Visits are by appointment; guest parking is behind the building.$md$)),
    jsonb_build_object('id', 'contact-map', 'type', 'image', 'data', jsonb_build_object(
      'image_path', 'cms/demo-contact-building.jpg', 'alt', 'The brick warehouse building that houses the agency office in the Dallas Design District',
      'caption', 'Find us on the second floor.', 'width', 'normal')),
    jsonb_build_object('id', 'contact-join', 'type', 'cta', 'data', jsonb_build_object(
      'heading', 'Want to be represented?', 'text', 'Applications are reviewed every week.', 'label', 'Apply to join', 'href', '/join', 'theme', 'light')))),
  (demo_seed.id('ee', 3), 'become-a-model', 'Become a model', 'How to become a model with 42', 'What we look for, how to apply, what happens next, and how to avoid scams.',
    'cms/demo-become-a-model.jpg', jsonb_build_array(
    jsonb_build_object('id', 'become-hero', 'type', 'hero', 'data', jsonb_build_object(
      'eyebrow', 'New faces', 'heading', 'Start with three simple photos.',
      'text', 'No professional pictures needed. A phone, a plain wall and daylight are enough.',
      'image_path', 'cms/demo-become-a-model.jpg', 'cta_label', 'Apply now', 'cta_href', '/join', 'theme', 'light')),
    jsonb_build_object('id', 'become-faq', 'type', 'rich_text', 'data', jsonb_build_object('heading', 'Questions we hear every week', 'body', $md$## What do you look for?
There is no single look. We sign people we believe we can book: for fashion, for commercial work, or both.

## Do I need experience or a portfolio?
No. Most of our new faces had never been on a set. We arrange your first test shoots.

## Does it cost anything to apply?
Never. A legitimate agency earns commission when you are booked. We will never ask you to pay to be represented.

## I am under 18. Can I apply?
Yes, with a parent or guardian, who must complete the form with you and attend every booking.

## What happens after I apply?
We review every application. If we would like to meet you, you will hear from us within two weeks.$md$)),
    jsonb_build_object('id', 'become-faces', 'type', 'talent_grid', 'data', jsonb_build_object(
      'heading', 'Recently signed', 'board', 'women/development', 'featured_only', false, 'limit', 4, 'sort', 'newest', 'show_link', true)),
    jsonb_build_object('id', 'become-cta', 'type', 'cta', 'data', jsonb_build_object(
      'heading', 'Ready?', 'text', 'The form takes about five minutes.', 'label', 'Apply to join', 'href', '/join', 'theme', 'dark')))),
  (demo_seed.id('ee', 4), 'model-expo', 'Model Expo', 'Model Expo weekend', 'A weekend of workshops, digitals and meetings with agencies. Dates to be announced.',
    null, jsonb_build_array(
    jsonb_build_object('id', 'expo-intro', 'type', 'rich_text', 'data', jsonb_build_object('heading', 'Model Expo', 'body', $md$A weekend of runway and posing workshops, professional digitals, and one-to-one meetings with our bookers and partner agencies.

Dates and registration for the next Expo will be announced here. This page is still being written.$md$))));

-- The legal pages stay drafts until a lawyer has reviewed them; the privacy draft
-- gets the demo contact address.
update public.website_pages set sections = jsonb_build_array(
  jsonb_build_object('id', 'privacy-body', 'type', 'rich_text', 'data', jsonb_build_object('heading', 'Privacy Policy', 'body', $md$[DRAFT: to be reviewed by the agency's legal adviser before publishing.]

## Who we are
42 Model Management ("we") represents models and talent. Contact: hello@northlight-demo.example.

## What we collect
- Applications: name, contact details, date of birth, measurements, photos and answers you submit through our registration form.
- Represented talent: the details needed to represent you, including contact, identity, payment and booking information.
- Website visitors: basic technical logs needed to run and secure the site.

## How we use it
To assess applications, represent talent, arrange bookings, pay talent, meet legal obligations, and keep the site secure. We only publish information and images you have approved for public display.

## Minors
Applications from people under 18 require a parent or guardian. We never publish a minor's date of birth, address or contact details.

## Sharing
We share talent information with clients only as needed for castings and bookings, and with service providers who host our systems under contract.

## Retention
Unsuccessful applications are deleted after 12 months. Talent records are kept for the length of representation and as required by law.

## Your rights
You can ask for a copy of your information, ask us to correct or delete it, or withdraw consent to SMS messages at any time by contacting us.$md$)))
where slug = 'privacy';

select public.publish_website_page(id) from public.website_pages where slug in ('about', 'services', 'contact', 'become-a-model') order by slug;

-- One live page has an edit waiting to be published (Website shows "unpublished changes").
select demo_seed.act_as('olivia');
update public.website_pages set meta_description = 'What we look for, how to apply, what happens after you apply, and why you should never pay to be represented.'
where slug = 'become-a-model';

select demo_seed.act_as('marcus');
insert into public.website_redirects (from_path, to_path, permanent, is_active, hits) values
  ('/talent', '/models', true, true, 214),
  ('/women-main-board', '/models/women/fashion', true, true, 96),
  ('/men-main-board', '/models/men/fashion', true, true, 71),
  ('/become-a-model.html', '/become-a-model', true, true, 158),
  ('/contact-us', '/contact', true, true, 43),
  ('/expo', '/model-expo', false, false, 12);

-- ===========================================================================
-- 14. GoHighLevel mirror (CRM sync screens)
-- ===========================================================================
-- In production these tables are written by the sync with the server key, so the
-- mirror is inserted with no user; the mapping decisions further down are made by
-- Marcus and audited. Write-back stays off: the demo has no GHL to push to.
-- Ids are invented and no custom field holds a URL or a file.
select demo_seed.act_as('system');

insert into public.ghl_pipelines (id, name, purpose, badge_label, first_seen_at, last_seen_at) values
  ('demoPipeRecruitment01', 'Talent Recruitment', 'talent', 'Talent Recruitment', demo_seed.ago(160), demo_seed.ago(0.04)),
  ('demoPipeModelExpo0002', 'Model Expo', null, null, demo_seed.ago(160), demo_seed.ago(0.04)),
  ('demoPipeClientBook003', 'Client Bookings', 'client', null, demo_seed.ago(160), demo_seed.ago(0.04)),
  ('demoPipeWorkshops0004', 'Workshop Waitlist', null, null, demo_seed.ago(6), demo_seed.ago(0.04));

insert into public.ghl_pipeline_stages (id, pipeline_id, name, position, normalized_status, mapping_source, first_seen_at, last_seen_at)
select v.id, v.pipeline_id, v.name, v.position, v.normalized_status, case when v.normalized_status is not null then 'initial' end, demo_seed.ago(v.seen_days), demo_seed.ago(0.04)
from (values
  ('demoStageRecLead001', 'demoPipeRecruitment01', 'New Lead', 0, 'lead', 160),
  ('demoStageRecApplied2', 'demoPipeRecruitment01', 'Application Received', 1, 'applicant', 160),
  ('demoStageRecScreen03', 'demoPipeRecruitment01', 'Screening Call', 2, 'screening', 160),
  ('demoStageRecAccept04', 'demoPipeRecruitment01', 'Accepted', 3, 'accepted', 160),
  ('demoStageRecActive05', 'demoPipeRecruitment01', 'Signed / Active', 4, 'active', 160),
  ('demoStageRecBooked06', 'demoPipeRecruitment01', 'Working / Booked', 5, 'booked', 160),
  ('demoStageRecNoFit007', 'demoPipeRecruitment01', 'Not a Fit', 6, 'rejected', 160),
  ('demoStageRecNurture8', 'demoPipeRecruitment01', 'Nurture / Follow Up', 7, null, 6),
  ('demoStageExpoRegist1', 'demoPipeModelExpo0002', 'Registered', 0, 'lead', 160),
  ('demoStageExpoDeposit', 'demoPipeModelExpo0002', 'Deposit Paid', 1, 'accepted', 160),
  ('demoStageExpoEnroll3', 'demoPipeModelExpo0002', 'Enrolled', 2, null, 160),
  ('demoStageExpoAttend4', 'demoPipeModelExpo0002', 'Attended / Graduated', 3, null, 160),
  ('demoStageExpoWithdr5', 'demoPipeModelExpo0002', 'Withdrew', 4, 'inactive', 160),
  ('demoStageCliInquiry1', 'demoPipeClientBook003', 'Inquiry', 0, null, 160),
  ('demoStageCliQuote002', 'demoPipeClientBook003', 'Quote Sent', 1, null, 160),
  ('demoStageCliBooked03', 'demoPipeClientBook003', 'Booked', 2, null, 160),
  ('demoStageCliLost0004', 'demoPipeClientBook003', 'Lost', 3, null, 160),
  ('demoStageWorkWait001', 'demoPipeWorkshops0004', 'Waitlisted', 0, null, 6),
  ('demoStageWorkInvite2', 'demoPipeWorkshops0004', 'Invited', 1, null, 6)
) as v(id, pipeline_id, name, position, normalized_status, seen_days);

insert into public.ghl_field_definitions (id, object_key, name, field_key, data_type, options, target, ownership, reviewed_at, reviewed_by, first_seen_at, last_seen_at)
select v.id, v.object_key, v.name, v.field_key, v.data_type, v.options::jsonb, v.target, v.ownership,
  case when v.reviewed then demo_seed.ago(150) end, case when v.reviewed then demo_seed.id('d0', 2) end, demo_seed.ago(v.seen_days), demo_seed.ago(0.04)
from (values
  ('demoFieldGender0001', 'contact', 'Gender', 'contact.gender', 'SINGLE_OPTIONS', '["Female", "Male", "Non-binary"]', 'gender', 'bidirectional', true, 160),
  ('demoFieldLocation02', 'contact', 'Current Location', 'contact.current_location', 'TEXT', null, 'location', 'bidirectional', true, 160),
  ('demoFieldInstagram3', 'contact', 'Instagram', 'contact.instagram', 'TEXT', null, 'instagram', 'bidirectional', true, 160),
  ('demoFieldTiktok0004', 'contact', 'TikTok', 'contact.tiktok', 'TEXT', null, 'tiktok', 'bidirectional', true, 160),
  ('demoFieldHeight0005', 'contact', 'Height', 'contact.height', 'TEXT', null, 'height_cm', 'bidirectional', true, 160),
  ('demoFieldBust000006', 'contact', 'Bust', 'contact.bust', 'TEXT', null, 'bust_cm', 'bidirectional', true, 160),
  ('demoFieldChest00007', 'contact', 'Chest', 'contact.chest', 'TEXT', null, 'bust_cm', 'bidirectional', true, 160),
  ('demoFieldWaist00008', 'contact', 'Waist', 'contact.waist', 'TEXT', null, 'waist_cm', 'bidirectional', true, 160),
  ('demoFieldHips000009', 'contact', 'Hips', 'contact.hips', 'TEXT', null, 'hips_cm', 'bidirectional', true, 160),
  ('demoFieldShoe000010', 'contact', 'Shoe Size', 'contact.shoe_size', 'TEXT', null, 'shoe_size', 'bidirectional', true, 160),
  ('demoFieldDress00011', 'contact', 'Dress Size', 'contact.dress_size', 'TEXT', null, null, 'ghl_only', false, 160),
  ('demoFieldHair000012', 'contact', 'Hair Color', 'contact.hair_color', 'TEXT', null, 'hair_color', 'bidirectional', true, 160),
  ('demoFieldEyes000013', 'contact', 'Eye Color', 'contact.eye_color', 'TEXT', null, 'eye_color', 'bidirectional', true, 160),
  ('demoFieldHeadshot14', 'contact', 'Headshot', 'contact.headshot', 'FILE_UPLOAD', null, 'photo_headshot', 'ghl_only', true, 160),
  ('demoFieldAngle00015', 'contact', '3/4 Angle', 'contact.34_angle', 'FILE_UPLOAD', null, 'photo_three_quarter', 'ghl_only', true, 160),
  ('demoFieldFullBody16', 'contact', 'Full Body', 'contact.full_body', 'FILE_UPLOAD', null, 'photo_full_body', 'ghl_only', true, 160),
  ('demoFieldHeardHow17', 'contact', 'How did you hear about us?', 'contact.how_did_you_hear_about_us', 'SINGLE_OPTIONS', '["Instagram", "Friend or family", "Open call", "Model Expo", "Search"]', null, 'ghl_only', true, 160),
  ('demoFieldGuardian18', 'contact', 'Parent / Guardian Name', 'contact.parent_guardian_name', 'TEXT', null, null, 'ghl_only', true, 160),
  ('demoFieldStatus0019', 'contact', 'Talent Status', 'contact.talent_status', 'SINGLE_OPTIONS', '["Active", "On hold", "Released"]', null, 'ghl_only', true, 160),
  ('demoFieldExperien20', 'contact', 'Modeling Experience', 'contact.modeling_experience', 'LARGE_TEXT', null, null, 'ghl_only', true, 160),
  ('demoFieldShirt00021', 'contact', 'T-Shirt Size', 'contact.shirt_size', 'SINGLE_OPTIONS', '["XS", "S", "M", "L", "XL"]', null, 'ghl_only', false, 6),
  ('demoFieldWeight0022', 'contact', 'Weight', 'contact.weight', 'TEXT', null, null, 'ghl_only', false, 6),
  ('demoFieldSession023', 'contact', 'Expo Session', 'contact.expo_session', 'SINGLE_OPTIONS', '["Saturday morning", "Saturday afternoon", "Sunday"]', null, 'ghl_only', false, 6),
  ('demoFieldOppPackage', 'opportunity', 'Expo Package', 'opportunity.expo_package', 'SINGLE_OPTIONS', '["Weekend pass", "Weekend pass plus digitals"]', null, 'ghl_only', false, 160),
  ('demoFieldOppLostWhy', 'opportunity', 'Lost Reason', 'opportunity.lost_reason', 'TEXT', null, null, 'ghl_only', false, 160)
) as v(id, object_key, name, field_key, data_type, options, target, ownership, reviewed, seen_days);

insert into public.ghl_users (id, name, email, role, last_seen_at) values
  ('demoUserOlivia00001', 'Olivia Hart', 'olivia.hart@northlight-demo.example', 'admin', demo_seed.ago(0.04)),
  ('demoUserDaniel00002', 'Daniel Okafor', 'daniel.okafor@northlight-demo.example', 'user', demo_seed.ago(0.04)),
  ('demoUserFrontDesk03', 'Front Desk', 'frontdesk@northlight-demo.example', 'user', demo_seed.ago(0.04));

insert into public.ghl_custom_values (id, name, field_key, value, first_seen_at, last_seen_at) values
  ('demoValueAgencyPhone', 'Agency Phone', '{{ custom_values.agency_phone }}', '(214) 555-0142', demo_seed.ago(160), demo_seed.ago(0.04)),
  ('demoValueBookingMail', 'Bookings Email', '{{ custom_values.bookings_email }}', 'hello@northlight-demo.example', demo_seed.ago(160), demo_seed.ago(0.04)),
  ('demoValueOpenCallDay', 'Open Call Day', '{{ custom_values.open_call_day }}', 'First Tuesday of the month, 4 to 6 pm', demo_seed.ago(160), demo_seed.ago(0.04)),
  ('demoValueExpoVenue01', 'Expo Venue', '{{ custom_values.expo_venue }}', 'Trinity Market Hall, Dallas', demo_seed.ago(90), demo_seed.ago(0.04)),
  ('demoValueOfficeHours', 'Office Hours', '{{ custom_values.office_hours }}', 'Monday to Friday, 9 am to 6 pm Central', demo_seed.ago(160), demo_seed.ago(0.04));

-- Contacts that belong to signed talent: built from the talent records, so GHL and
-- the dashboard agree. They are linked in a second step, as the sync does.
insert into public.ghl_contacts (id, first_name, last_name, email, phone, date_of_birth, contact_type, source, tags, assigned_to, city, state, country,
  custom_fields, source_created_at, source_updated_at, full_fetched_at, synced_at, crm_status, crm_status_reason, programs)
select 'demoContact' || lpad(v.n::text, 4, '0'), t.first_name, t.last_name, pd.email, pd.mobile, pd.date_of_birth, 'customer', v.source, v.tags::text[], v.assigned_to,
  split_part(t.location, ', ', 1), 'TX', 'US',
  jsonb_strip_nulls(jsonb_build_object(
    'demoFieldGender0001', t.gender,
    'demoFieldLocation02', t.location,
    'demoFieldInstagram3', (select s.handle from public.talent_social_accounts s where s.talent_id = t.id and s.platform = 'Instagram' limit 1),
    'demoFieldHeight0005', demo_seed.feet(m.height_cm),
    'demoFieldBust000006', case when t.gender <> 'Male' then demo_seed.inches(m.bust_chest_cm) end,
    'demoFieldChest00007', case when t.gender = 'Male' then demo_seed.inches(m.bust_chest_cm) end,
    'demoFieldWaist00008', demo_seed.inches(m.waist_cm),
    'demoFieldHips000009', demo_seed.inches(m.hips_cm),
    'demoFieldShoe000010', m.shoe_size_us,
    'demoFieldHair000012', m.hair_color,
    'demoFieldEyes000013', m.eye_color,
    'demoFieldHeardHow17', v.heard,
    'demoFieldStatus0019', v.talent_status)),
  demo_seed.ago(v.created_days), demo_seed.ago(v.updated_days), demo_seed.ago(v.updated_days), demo_seed.ago(0.04), t.crm_status, v.reason, t.crm_programs
from (values
  (1, 'Open call', '{signed talent,main board}', 'demoUserDaniel00002', 'Open call', 'Active', 1300, 9, 'Talent Recruitment → Signed / Active'),
  (2, 'Referral', '{signed talent,main board}', 'demoUserDaniel00002', 'Friend or family', 'Active', 1120, 20, 'Talent Recruitment → Signed / Active'),
  (3, 'Model Expo landing page', '{signed talent,expo alumni}', 'demoUserOlivia00001', 'Model Expo', 'Active', 930, 4, 'Talent Recruitment → Working / Booked'),
  (5, 'Join Us form', '{signed talent}', 'demoUserDaniel00002', 'Instagram', 'Active', 560, 14, 'Talent Recruitment → Signed / Active'),
  (7, 'Model Expo landing page', '{expo alumni}', 'demoUserOlivia00001', 'Model Expo', 'Active', 340, 30, 'Model Expo → Attended / Graduated'),
  (8, 'Model Expo landing page', '{expo alumni,minor}', 'demoUserOlivia00001', 'Model Expo', 'Active', 450, 25, 'Model Expo → Attended / Graduated'),
  (11, 'Instagram DM', '{signed talent}', 'demoUserDaniel00002', 'Instagram', 'Active', 690, 11, 'Talent Recruitment → Signed / Active'),
  (15, 'Join Us form', '{signed talent,new face}', 'demoUserDaniel00002', 'Search', 'Active', 230, 6, 'Talent Recruitment → Signed / Active'),
  (17, 'Model Expo landing page', '{expo enrolled}', 'demoUserOlivia00001', 'Model Expo', null, 170, 8, 'Model Expo → Enrolled'),
  (21, 'Join Us form', '{new face}', 'demoUserDaniel00002', 'Instagram', null, 34, 12, 'Talent Recruitment → Accepted'),
  (23, 'Model Expo landing page', '{expo enrolled}', 'demoUserOlivia00001', 'Friend or family', 'On hold', 48, 6, 'Model Expo → Enrolled')
) as v(n, source, tags, assigned_to, heard, talent_status, created_days, updated_days, reason)
join public.talent t on t.id = demo_seed.t(v.n)
join public.talent_private_details pd on pd.talent_id = t.id
left join lateral (
  select * from public.talent_measurements tm where tm.talent_id = t.id order by tm.is_official desc, tm.measured_on desc limit 1
) m on true;

-- Everyone else in the CRM: leads, applicants, Expo registrants, clients.
insert into public.ghl_contacts (id, first_name, last_name, email, phone, date_of_birth, contact_type, source, tags, assigned_to, city, state, country,
  custom_fields, source_created_at, source_updated_at, full_fetched_at, synced_at, crm_status, crm_status_reason, programs, auto_create_blocked, removed_at)
select 'demoContact' || lpad(v.n::text, 4, '0'), v.first_name, v.last_name, v.email, v.phone, v.dob, v.contact_type, v.source, v.tags::text[], v.assigned_to, v.city, 'TX', 'US',
  v.custom_fields::jsonb, demo_seed.ago(v.created_days), demo_seed.ago(v.updated_days), demo_seed.ago(v.updated_days), demo_seed.ago(0.04), v.crm_status, v.reason, '{}',
  v.n = 124, case when v.n = 123 then demo_seed.ago(3) end
from (values
  (101, 'Harper', 'Quinn', 'harper.quinn@applicant-demo.example', '(214) 555-0140', demo_seed.born(19, 80), 'lead', 'Join Us form', '{applicant}', 'demoUserDaniel00002', 'Dallas',
    '{"demoFieldGender0001": "Female", "demoFieldHeight0005": "5''10", "demoFieldHeardHow17": "Instagram", "demoFieldInstagram3": "@harperquinn.tx"}', 1, 1, 'applicant', 'Talent Recruitment → Application Received'),
  (102, 'Elijah', 'Brandt', 'elijah.brandt@applicant-demo.example', '(817) 555-0141', demo_seed.born(22, 140), 'lead', 'Join Us form', '{applicant}', 'demoUserDaniel00002', 'Fort Worth',
    '{"demoFieldGender0001": "Male", "demoFieldHeight0005": "6''2", "demoFieldHeardHow17": "Friend or family"}', 2, 2, 'applicant', 'Talent Recruitment → Application Received'),
  (103, 'Annika', 'Rao', 'anika.rao@talent-demo.example', '(469) 555-0115', demo_seed.born(19, 100), 'lead', 'Join Us form', '{applicant}', null, 'Irving',
    '{"demoFieldGender0001": "Female", "demoFieldHeardHow17": "Search"}', 3, 3, 'lead', 'Talent Recruitment → New Lead'),
  (104, 'Lily', 'Castellanos', 'marisa.castellanos@applicant-demo.example', '(972) 555-0143', demo_seed.born(15, 210), 'lead', 'Join Us form', '{applicant,minor}', 'demoUserDaniel00002', 'Garland',
    '{"demoFieldGender0001": "Female", "demoFieldGuardian18": "Marisa Castellanos", "demoFieldHeardHow17": "Open call"}', 4, 4, 'applicant', 'Talent Recruitment → Application Received'),
  (105, 'Jasmine', 'Whitaker', 'jasmine.whitaker@applicant-demo.example', '(713) 555-0144', demo_seed.born(24, 33), 'lead', 'Join Us form', '{applicant,reapplied}', 'demoUserDaniel00002', 'Houston',
    '{"demoFieldGender0001": "Female", "demoFieldHeight0005": "5''9", "demoFieldExperien20": "Two years of local runway and a few boutique lookbooks.", "demoFieldHeardHow17": "Instagram"}', 9, 5, 'screening', 'Talent Recruitment → Screening Call'),
  (106, 'Owen', 'Fitzgerald', 'owen.fitzgerald@applicant-demo.example', '(512) 555-0145', demo_seed.born(27, 260), 'lead', 'Open call', '{applicant}', 'demoUserOlivia00001', 'Austin',
    '{"demoFieldGender0001": "Male", "demoFieldHeight0005": "6''1", "demoFieldHeardHow17": "Open call"}', 11, 6, 'screening', 'Talent Recruitment → Screening Call'),
  (107, 'Sadie', 'Kowalski', 'beth.kowalski@applicant-demo.example', '(469) 555-0146', demo_seed.born(17, 45), 'lead', 'Join Us form', '{applicant,minor}', 'demoUserDaniel00002', 'Plano',
    '{"demoFieldGender0001": "Female", "demoFieldGuardian18": "Beth Kowalski"}', 13, 7, 'applicant', 'Talent Recruitment → Application Received'),
  (108, 'Dominic', 'Reyes-Hall', 'dominic.reyeshall@applicant-demo.example', '(817) 555-0147', demo_seed.born(20, 300), 'lead', 'Instagram DM', '{applicant}', 'demoUserDaniel00002', 'Arlington',
    '{"demoFieldGender0001": "Male", "demoFieldInstagram3": "@dom.reyeshall"}', 15, 8, 'applicant', 'Talent Recruitment → Application Received'),
  (110, 'Celeste', 'Moreau', 'celeste.moreau@applicant-demo.example', '(214) 555-0148', demo_seed.born(21, 120), 'lead', 'Join Us form', '{applicant,approved}', 'demoUserDaniel00002', 'Dallas',
    '{"demoFieldGender0001": "Female", "demoFieldHeight0005": "5''10", "demoFieldHair000012": "Red", "demoFieldEyes000013": "Green", "demoFieldHeardHow17": "Search"}', 20, 3, 'accepted', 'Talent Recruitment → Accepted'),
  (111, 'Andre', 'Bellamy', 'andre.bellamy@applicant-demo.example', '(214) 555-0149', demo_seed.born(23, 15), 'lead', 'Referral', '{applicant,approved}', 'demoUserOlivia00001', 'Dallas',
    '{"demoFieldGender0001": "Male", "demoFieldHeight0005": "6''2", "demoFieldHeardHow17": "Friend or family"}', 24, 4, 'accepted', 'Talent Recruitment → Accepted'),
  (112, 'Whitney', 'Sloan', 'whitney.sloan@applicant-demo.example', '(940) 555-0192', demo_seed.born(30, 200), 'lead', 'Join Us form', '{applicant}', null, 'Denton',
    '{"demoFieldGender0001": "Female"}', 70, 40, 'inactive', 'Talent Recruitment → Application Received (abandoned)'),
  (113, 'Paige', 'Hollister', 'paige.hollister@expo-demo.example', '(972) 555-0193', demo_seed.born(18, 60), 'lead', 'Model Expo landing page', '{expo registered}', 'demoUserFrontDesk03', 'Allen',
    '{"demoFieldGender0001": "Female", "demoFieldSession023": "Saturday morning"}', 8, 8, 'lead', 'Model Expo → Registered'),
  (114, 'Miles', 'Okonkwo', 'miles.okonkwo@expo-demo.example', '(214) 555-0194', demo_seed.born(19, 310), 'lead', 'Model Expo landing page', '{expo registered,deposit paid}', 'demoUserFrontDesk03', 'Dallas',
    '{"demoFieldGender0001": "Male", "demoFieldSession023": "Saturday afternoon", "demoFieldShirt00021": "M"}', 12, 5, 'accepted', 'Model Expo → Deposit Paid'),
  (116, 'Juniper', 'Hayes', 'juniper.hayes@expo-demo.example', '(817) 555-0195', demo_seed.born(16, 20), 'lead', 'Model Expo landing page', '{expo registered,minor}', 'demoUserFrontDesk03', 'Keller',
    '{"demoFieldGender0001": "Female", "demoFieldGuardian18": "Nora Hayes", "demoFieldSession023": "Sunday"}', 5, 5, 'lead', 'Model Expo → Registered'),
  (117, 'Rosalind', 'Achebe', 'rosalind.achebe@applicant-demo.example', '(713) 555-0196', demo_seed.born(26, 90), 'lead', 'Instagram DM', '{follow up}', 'demoUserDaniel00002', 'Houston',
    '{"demoFieldGender0001": "Female", "demoFieldInstagram3": "@rosalind.achebe"}', 45, 6, null, null),
  (118, 'Graham', 'Tully', 'graham.tully@applicant-demo.example', '(210) 555-0197', demo_seed.born(38, 12), 'lead', 'Join Us form', '{applicant}', null, 'San Antonio',
    '{"demoFieldGender0001": "Male"}', 95, 80, 'rejected', 'Talent Recruitment → Not a Fit'),
  (119, 'Bianca', 'Trevino', 'bianca.trevino@expo-demo.example', '(512) 555-0198', demo_seed.born(20, 150), 'lead', 'Model Expo landing page', '{expo registered}', 'demoUserFrontDesk03', 'Round Rock',
    '{"demoFieldGender0001": "Female", "demoFieldWeight0022": "125 lbs"}', 130, 60, 'inactive', 'Model Expo → Withdrew'),
  (120, 'Meredith', 'Calloway', 'meredith.calloway@haldenrowe.example', '(214) 555-0175', null, 'customer', 'Client referral', '{client}', 'demoUserOlivia00001', 'Dallas',
    '{}', 400, 12, null, null),
  (121, 'Wyatt', 'Garrison', 'wyatt.garrison@bluebonnetdenim.example', '(512) 555-0179', null, 'customer', 'Website contact form', '{client}', 'demoUserOlivia00001', 'Austin',
    '{}', 380, 21, null, null),
  (122, 'Nadia', 'Ferreira', 'nadia.ferreira@applicant-demo.example', '(214) 555-0199', demo_seed.born(22, 5), 'lead', 'Instagram DM', '{}', null, 'Dallas',
    '{"demoFieldGender0001": "Female", "demoFieldInstagram3": "@nadia.ferreira"}', 2, 2, 'lead', 'Talent Recruitment → New Lead'),
  (123, 'Caleb', 'Winters', 'caleb.winters@applicant-demo.example', '(972) 555-0169', demo_seed.born(25, 70), 'lead', 'Join Us form', '{duplicate}', null, 'Frisco',
    '{"demoFieldGender0001": "Male"}', 60, 10, 'lead', 'Talent Recruitment → New Lead'),
  (124, 'Victor', 'Hale', 'victor.hale@talent-demo.example', '(214) 555-0124', demo_seed.born(34, 50), 'customer', 'Open call', '{do not contact,former talent}', 'demoUserOlivia00001', 'Dallas',
    '{"demoFieldGender0001": "Male", "demoFieldStatus0019": "Released"}', 1900, 85, 'archived', 'Tag "do not contact"')
) as v(n, first_name, last_name, email, phone, dob, contact_type, source, tags, assigned_to, city, custom_fields, created_days, updated_days, crm_status, reason);

update public.ghl_contacts c set talent_id = demo_seed.t(v.n)
from (values (1), (2), (3), (5), (7), (8), (11), (15), (17), (21), (23)) as v(n)
where c.id = 'demoContact' || lpad(v.n::text, 4, '0');

-- Opportunities: where each person sits in each pipeline.
insert into public.ghl_opportunities (id, contact_id, pipeline_id, stage_id, name, status, monetary_value, source, assigned_to,
  last_stage_change_at, last_status_change_at, source_created_at, source_updated_at, synced_at)
select 'demoOpportunity' || lpad((row_number() over (order by v.contact, v.stage_id))::text, 4, '0'), c.id, s.pipeline_id, s.id,
  trim(c.first_name || ' ' || c.last_name) || ' - ' || p.name, v.status, v.amount, c.source, c.assigned_to,
  demo_seed.ago(v.changed_days), demo_seed.ago(v.changed_days), c.source_created_at, demo_seed.ago(v.changed_days), demo_seed.ago(0.04)
from (values
  (1, 'demoStageRecActive05', 'won', null, 1270), (2, 'demoStageRecActive05', 'won', null, 1100),
  (3, 'demoStageExpoAttend4', 'won', 495, 900), (3, 'demoStageRecBooked06', 'won', null, 30),
  (5, 'demoStageRecActive05', 'won', null, 535), (7, 'demoStageExpoAttend4', 'won', 495, 305),
  (8, 'demoStageExpoAttend4', 'won', 645, 415), (11, 'demoStageRecActive05', 'won', null, 665),
  (15, 'demoStageRecActive05', 'won', null, 195), (17, 'demoStageExpoEnroll3', 'open', 495, 60),
  (21, 'demoStageRecAccept04', 'open', null, 12), (23, 'demoStageExpoEnroll3', 'open', 645, 9),
  (101, 'demoStageRecApplied2', 'open', null, 1), (102, 'demoStageRecApplied2', 'open', null, 2),
  (103, 'demoStageRecLead001', 'open', null, 3), (104, 'demoStageRecApplied2', 'open', null, 4),
  (105, 'demoStageRecScreen03', 'open', null, 5), (106, 'demoStageRecScreen03', 'open', null, 6),
  (107, 'demoStageRecApplied2', 'open', null, 13), (108, 'demoStageRecApplied2', 'open', null, 15),
  (110, 'demoStageRecAccept04', 'open', null, 3), (111, 'demoStageRecAccept04', 'open', null, 4),
  (112, 'demoStageRecApplied2', 'abandoned', null, 40), (113, 'demoStageExpoRegist1', 'open', 495, 8),
  (114, 'demoStageExpoDeposit', 'open', 495, 5), (116, 'demoStageExpoRegist1', 'open', 645, 5),
  (117, 'demoStageRecNurture8', 'open', null, 6), (118, 'demoStageRecNoFit007', 'lost', null, 80),
  (119, 'demoStageExpoWithdr5', 'lost', 495, 60), (120, 'demoStageCliBooked03', 'won', 6000, 12),
  (120, 'demoStageCliQuote002', 'open', 6400, 9), (121, 'demoStageCliBooked03', 'won', 4700, 21),
  (122, 'demoStageRecLead001', 'open', null, 2), (122, 'demoStageWorkWait001', 'open', null, 2),
  (123, 'demoStageRecLead001', 'open', null, 10)
) as v(contact, stage_id, status, amount, changed_days)
join public.ghl_contacts c on c.id = 'demoContact' || lpad(v.contact::text, 4, '0')
join public.ghl_pipeline_stages s on s.id = v.stage_id
join public.ghl_pipelines p on p.id = s.pipeline_id;

-- Stage changes the sync has observed.
insert into public.ghl_opportunity_history (opportunity_id, contact_id, pipeline_id, from_stage_id, to_stage_id, from_status, to_status, changed_at, recorded_at)
select o.id, o.contact_id, o.pipeline_id, v.from_stage, v.to_stage, v.from_status, v.to_status, demo_seed.ago(v.days_ago), demo_seed.ago(v.days_ago - 0.02)
from (values
  (21, 'demoStageRecAccept04', null, 'demoStageRecApplied2', null, 'open', 34),
  (21, 'demoStageRecAccept04', 'demoStageRecApplied2', 'demoStageRecScreen03', 'open', 'open', 22),
  (21, 'demoStageRecAccept04', 'demoStageRecScreen03', 'demoStageRecAccept04', 'open', 'open', 12),
  (23, 'demoStageExpoEnroll3', null, 'demoStageExpoRegist1', null, 'open', 48),
  (23, 'demoStageExpoEnroll3', 'demoStageExpoRegist1', 'demoStageExpoDeposit', 'open', 'open', 30),
  (23, 'demoStageExpoEnroll3', 'demoStageExpoDeposit', 'demoStageExpoEnroll3', 'open', 'open', 9),
  (3, 'demoStageRecBooked06', 'demoStageRecActive05', 'demoStageRecBooked06', 'won', 'won', 30),
  (15, 'demoStageRecActive05', 'demoStageRecAccept04', 'demoStageRecActive05', 'open', 'won', 195),
  (17, 'demoStageExpoEnroll3', 'demoStageExpoDeposit', 'demoStageExpoEnroll3', 'open', 'open', 60),
  (105, 'demoStageRecScreen03', 'demoStageRecApplied2', 'demoStageRecScreen03', 'open', 'open', 5),
  (106, 'demoStageRecScreen03', 'demoStageRecApplied2', 'demoStageRecScreen03', 'open', 'open', 6),
  (110, 'demoStageRecAccept04', 'demoStageRecScreen03', 'demoStageRecAccept04', 'open', 'open', 3),
  (111, 'demoStageRecAccept04', 'demoStageRecScreen03', 'demoStageRecAccept04', 'open', 'open', 4),
  (112, 'demoStageRecApplied2', 'demoStageRecApplied2', 'demoStageRecApplied2', 'open', 'abandoned', 40),
  (114, 'demoStageExpoDeposit', 'demoStageExpoRegist1', 'demoStageExpoDeposit', 'open', 'open', 5),
  (118, 'demoStageRecNoFit007', 'demoStageRecScreen03', 'demoStageRecNoFit007', 'open', 'lost', 80),
  (119, 'demoStageExpoWithdr5', 'demoStageExpoDeposit', 'demoStageExpoWithdr5', 'open', 'lost', 60)
) as v(contact, current_stage, from_stage, to_stage, from_status, to_status, days_ago)
join public.ghl_opportunities o on o.contact_id = 'demoContact' || lpad(v.contact::text, 4, '0') and o.stage_id = v.current_stage;

-- The last value both sides agreed on, per linked talent and field.
insert into public.ghl_field_state (talent_id, target, value, source, synced_at)
select c.talent_id, f.target, f.value, 'ghl', c.source_updated_at
from public.ghl_contacts c
join public.talent t on t.id = c.talent_id
join public.talent_private_details pd on pd.talent_id = t.id
left join lateral (
  select * from public.talent_measurements tm where tm.talent_id = t.id order by tm.is_official desc, tm.measured_on desc limit 1
) m on true
cross join lateral (values
  ('first_name', t.first_name), ('last_name', t.last_name), ('email', pd.email), ('phone', pd.mobile), ('date_of_birth', pd.date_of_birth::text),
  ('gender', t.gender), ('location', t.location), ('height_cm', m.height_cm::text), ('hair_color', m.hair_color), ('eye_color', m.eye_color),
  ('instagram', (select s.handle from public.talent_social_accounts s where s.talent_id = t.id and s.platform = 'Instagram' limit 1))
) as f(target, value)
where f.value is not null;

-- Sync history: hourly reconciliation, one manual run, one discovery, one failure.
insert into public.ghl_sync_runs (kind, trigger, status, cursor, stats, error, triggered_by, started_at, heartbeat_at, finished_at)
select v.kind, v.trigger, v.status, v.cursor::jsonb, v.stats::jsonb, v.error, case when v.trigger = 'dashboard' then demo_seed.id('d0', 2) end,
  demo_seed.ago(v.days_ago), demo_seed.ago(v.days_ago) + v.took * interval '1 second', demo_seed.ago(v.days_ago) + v.took * interval '1 second'
from (values
  ('reconcile', 'cron', 'failed', '{"phase": "contacts", "page": 2}', '{"contacts_seen": 20, "contacts_synced": 14}',
    'GoHighLevel answered 429 (too many requests) while listing contacts. The next scheduled run resumes from the saved position.', 9.2, 41),
  ('reconcile', 'cron', 'succeeded', '{"phase": "done"}', '{"contacts_seen": 30, "contacts_synced": 30, "opportunities_seen": 31, "opportunity_changes": 4, "talents_updated": 3, "fields_applied": 11, "jobs_done": 2}', null, 9.16, 73),
  ('discovery', 'dashboard', 'succeeded', '{"phase": "done"}', '{"pipelines_seen": 4, "pipelines_discovered": 1, "stages_discovered": 3, "fields_seen": 25, "fields_discovered": 3}', null, 6.1, 9),
  ('reconcile', 'cron', 'succeeded', '{"phase": "done"}', '{"contacts_seen": 31, "contacts_synced": 5, "opportunities_seen": 33, "opportunity_changes": 3, "talents_linked_or_created": 1, "talents_updated": 2, "fields_applied": 7, "photos_stored": 2, "jobs_done": 3}', null, 5.9, 58),
  ('reconcile', 'cron', 'succeeded', '{"phase": "done"}', '{"contacts_seen": 32, "contacts_synced": 3, "opportunities_seen": 34, "opportunity_changes": 2, "conflicts_detected": 1, "fields_applied": 4}', null, 3.0, 49),
  ('reconcile', 'dashboard', 'succeeded', '{"phase": "done"}', '{"contacts_seen": 32, "contacts_synced": 32, "opportunities_seen": 34, "opportunity_changes": 1, "talents_updated": 4, "fields_applied": 9, "photos_duplicate": 2, "conflicts_detected": 1, "jobs_done": 1}', null, 1.1, 88),
  ('reconcile', 'cron', 'succeeded', '{"phase": "done"}', '{"contacts_seen": 33, "contacts_synced": 2, "opportunities_seen": 35, "opportunity_changes": 2, "fields_applied": 3, "jobs_failed": 1}', null, 0.21, 44),
  ('reconcile', 'cron', 'succeeded', '{"phase": "done"}', '{"contacts_seen": 33, "contacts_synced": 1, "opportunities_seen": 35, "opportunity_changes": 1, "fields_applied": 1}', null, 0.04, 39)
) as v(kind, trigger, status, cursor, stats, error, days_ago, took);

insert into public.ghl_sync_jobs (kind, external_id, reason, status, attempts, next_attempt_at, last_error, created_at, updated_at, finished_at)
select 'contact', 'demoContact' || lpad(v.contact::text, 4, '0'), v.reason, v.status, v.attempts, demo_seed.ago(v.days_ago) + v.retry_in * interval '1 hour', v.last_error,
  demo_seed.ago(v.days_ago), demo_seed.ago(v.days_ago - 0.001), case when v.status = 'done' then demo_seed.ago(v.days_ago - 0.001) end
from (values
  (21, 'webhook: OpportunityStageUpdate', 'done', 1, 12, 0, null),
  (23, 'webhook: OpportunityStageUpdate', 'done', 1, 9, 0, null),
  (105, 'webhook: ContactUpdate', 'done', 1, 5, 0, null),
  (110, 'webhook: OpportunityStageUpdate', 'done', 2, 3, 0, null),
  (101, 'webhook: ContactCreate', 'done', 1, 1, 0, null),
  (122, 'webhook: ContactCreate', 'done', 1, 2, 0, null),
  (123, 'reconcile', 'failed', 3, 0.2, 9, 'GoHighLevel answered 404: contact not found. It may have been deleted or merged in GHL.')
) as v(contact, reason, status, attempts, days_ago, retry_in, last_error);

-- Two values changed on both sides since the last sync: staff choose which to keep.
insert into public.ghl_sync_conflicts (talent_id, contact_id, target, base_value, dashboard_value, ghl_value, status, detected_at) values
  (demo_seed.t(5), 'demoContact0005', 'height_cm', '176', '177', '175.3', 'open', demo_seed.ago(3.0)),
  (demo_seed.t(11), 'demoContact0011', 'instagram', '@imani.okoye', '@imani.okoye.model', '@imaniokoye.official', 'open', demo_seed.ago(1.1)),
  (demo_seed.t(2), 'demoContact0002', 'location', 'Austin, TX', 'Austin, TX', 'New York, NY', 'open', demo_seed.ago(20));

-- Photos the sync stored for Tessa from her GHL form uploads.
update public.talent_photos set photo_role = case when image_type = 'headshot' then 'headshot' else 'full_body' end,
  external_id = 'demoFile' || lpad(display_order::text, 4, '0'), synced_at = demo_seed.ago(5.9)
where talent_id = demo_seed.t(23);

-- Mapping decisions made in Dashboard → GHL Sync (audited; one stage, one pipeline
-- and four fields are left for review so the counters are not all zero).
select demo_seed.act_as('marcus');
update public.ghl_pipelines set purpose = 'talent', badge_label = 'Model Expo' where id = 'demoPipeModelExpo0002';
update public.ghl_pipeline_stages set normalized_status = 'enrolled' where id = 'demoStageExpoEnroll3';
update public.ghl_pipeline_stages set normalized_status = 'graduated' where id = 'demoStageExpoAttend4';
update public.ghl_field_definitions set target = 'dress_size', ownership = 'bidirectional' where id = 'demoFieldDress00011';
insert into public.ghl_status_rules (kind, field_id, match_value, normalized_status) values
  ('tag', null, 'signed talent', 'active'),
  ('tag', null, 'do not contact', 'archived'),
  ('contact_field', 'demoFieldStatus0019', 'On hold', 'inactive');
update public.ghl_sync_conflicts set status = 'kept_dashboard' where talent_id = demo_seed.t(2) and target = 'location';

-- ===========================================================================
-- 15. CDS import staging (the previous booking system)
-- ===========================================================================
-- What the owner's browser read from CDS / WebForFashion. Five records matched
-- talent already in the dashboard, three were added as new drafts, one needs a
-- decision, two have not been applied yet and one was skipped.
select demo_seed.act_as('olivia');

insert into public.cds_talents (cds_id, wff_id, first_name, last_name, email, phone, gender, location, profile, cds_boards, portfolios,
  match_status, match_reason, extracted_at, applied_at, created_at)
select v.cds_id, v.wff_id, t.first_name, t.last_name, pd.email, pd.mobile, t.gender, split_part(t.location, ',', 1),
  jsonb_build_object('date_of_birth', pd.date_of_birth, 'date_joined', t.date_joined, 'birth_place', pd.birth_place, 'nationality', pd.nationality, 'website', null,
    'stats', jsonb_strip_nulls(jsonb_build_object('height_cm', m.height_cm::text, 'bust_cm', m.bust_chest_cm::text, 'waist_cm', m.waist_cm::text, 'hips_cm', m.hips_cm::text,
      'shoe_us', m.shoe_size_us, 'hair_color', m.hair_color, 'eyes_color', m.eye_color)),
    'skills', coalesce((select jsonb_agg(jsonb_build_object('skill', s.skill, 'level', s.level)) from public.talent_skills s where s.talent_id = t.id), '[]'::jsonb)),
  array[v.cds_board],
  jsonb_build_array(jsonb_build_object('id', (9944000 + v.n)::text, 'name', v.portfolio, 'website', true,
    'media', (select jsonb_agg((8900000 + v.n * 100 + g)::text order by g) from generate_series(1, 3) g))),
  v.match_status, v.match_reason, demo_seed.ago(21), demo_seed.ago(20.9), demo_seed.ago(21)
from (values
  (2, '48102', '7710102', 'Men Mainboard', 'Fashion-Men', 'matched', 'email'),
  (4, '48104', '7710104', 'Men Mainboard', 'Fashion-Men', 'matched', 'email'),
  (6, '48106', '7710106', 'Curve', 'Curve-Women', 'matched', 'phone'),
  (12, '48112', '7710112', 'Women Commercial', 'Commercial-Women', 'matched', 'name'),
  (14, '48114', '7710114', 'Men Commercial', 'Commercial-Men', 'matched', 'email'),
  (16, '48116', '7710116', 'Curve', 'Fashion-Women', 'created', null),
  (19, '48119', '7710119', 'Men Commercial', 'Commercial-Men', 'created', null),
  (22, '48122', '7710122', 'Men Development', 'Development-Men', 'created', null)
) as v(n, cds_id, wff_id, cds_board, portfolio, match_status, match_reason)
join public.talent t on t.id = demo_seed.t(v.n)
join public.talent_private_details pd on pd.talent_id = t.id
left join lateral (
  select * from public.talent_measurements tm where tm.talent_id = t.id order by tm.is_official desc, tm.measured_on desc limit 1
) m on true;

insert into public.cds_talents (cds_id, wff_id, first_name, last_name, email, phone, gender, location, profile, cds_boards, portfolios,
  match_status, match_reason, extracted_at, applied_at, created_at)
select v.cds_id, v.wff_id, v.first_name, v.last_name, v.email, v.phone, v.gender, v.location, v.profile::jsonb, array[v.cds_board],
  jsonb_build_array(jsonb_build_object('id', (9944000 + v.n)::text, 'name', v.portfolio, 'website', v.n <> 33,
    'media', (select jsonb_agg((8900000 + v.n * 100 + g)::text order by g) from generate_series(1, 3) g))),
  v.match_status, v.match_reason, demo_seed.ago(21), case when v.match_status <> 'pending' then demo_seed.ago(20.9) end, demo_seed.ago(21)
from (values
  (30, '48130', '7710130', 'Theo', 'Lindgren', 'theo.l@cds-demo.example', '(214) 555-0170', 'Male', 'Dallas', 'Men Mainboard', 'Fashion-Men', 'review', 'Same name, different date of birth',
    '{"date_of_birth": "1999-03-14", "date_joined": null, "birth_place": null, "nationality": "American", "website": null, "stats": {"height_cm": "189", "hair_color": "Blonde", "eyes_color": "Blue"}, "skills": []}'),
  (31, '48131', '7710131', 'Odette', 'Marsh', 'odette.marsh@cds-demo.example', '(469) 555-0171', 'Female', 'Richardson', 'Women Mainboard', 'Fashion-Women', 'pending', null,
    '{"date_of_birth": null, "date_joined": null, "birth_place": null, "nationality": null, "website": null, "stats": {"height_cm": "177", "bust_cm": "82", "waist_cm": "61", "hips_cm": "89", "hair_color": "Brown", "eyes_color": "Hazel"}, "skills": [{"skill": "Runway", "level": "Advanced"}]}'),
  (32, '48132', '7710132', 'Calvin', 'Rhodes', 'calvin.rhodes@cds-demo.example', '(817) 555-0172', 'Male', 'Fort Worth', 'Teens', 'Teens-Boys', 'pending', null,
    '{"date_of_birth": null, "date_joined": null, "birth_place": null, "nationality": null, "website": null, "stats": {"height_cm": "175", "hair_color": "Black", "eyes_color": "Brown"}, "skills": []}'),
  (33, '48133', '7710133', 'Bianca', 'Trevino', 'bianca.trevino@expo-demo.example', '(512) 555-0198', 'Female', 'Round Rock', 'Lifestyle', 'Lifestyle', 'skipped', 'Left the agency before the move; not imported',
    '{"date_of_birth": null, "date_joined": null, "birth_place": null, "nationality": null, "website": null, "stats": {}, "skills": []}')
) as v(n, cds_id, wff_id, first_name, last_name, email, phone, gender, location, cds_board, portfolio, match_status, match_reason, profile);

-- Linking is an update, so it is audited (who linked which record, and how).
update public.cds_talents c set talent_id = demo_seed.t(v.n)
from (values ('48102', 2), ('48104', 4), ('48106', 6), ('48112', 12), ('48114', 14), ('48116', 16), ('48119', 19), ('48122', 22)) as v(cds_id, n)
where c.cds_id = v.cds_id;

-- Six media rows per person: four photos, a digital and a video. Photos of the new
-- drafts were copied (and point at the stored photo); talent who already had photos
-- were left alone; one copy failed and can be retried.
insert into public.cds_media (wff_media_id, cds_id, kind, position, metadata, photo_id, status, error, extracted_at)
select (8900000 + (c.cds_id::int - 48100) * 100 + g)::text, c.cds_id,
  case when g <= 4 then 'image' when g = 5 then 'digital' else 'video' end, case when g = 6 then 0 else g - 1 end,
  case when g <= 4 then jsonb_build_object('web', g <= 2, 'primary', g = 1) else '{}'::jsonb end,
  ph.id,
  case when g = 6 then case when c.match_status in ('created', 'matched') then 'skipped' else 'listed' end
       when c.cds_id = '48122' and g = 4 then 'failed'
       when c.match_status = 'created' and ph.id is not null then 'imported'
       when c.match_status in ('created', 'matched') then 'skipped'
       else 'listed' end,
  case when c.cds_id = '48122' and g = 4 then 'The signed link had expired before this photo could be copied. Run step 4 again to retry.' end,
  demo_seed.ago(21)
from public.cds_talents c
cross join generate_series(1, 6) g
left join public.talent_photos ph on c.match_status = 'created' and ph.talent_id = c.talent_id and ph.source = 'cds'
  and ph.display_order = case when g <= 4 then g when g = 5 then (select max(x.display_order) from public.talent_photos x where x.talent_id = c.talent_id and x.image_type = 'digital') end
  and (g <= 4 and ph.image_type <> 'digital' or g = 5 and ph.image_type = 'digital');

insert into public.cds_portfolio_boards (portfolio_name, board_id, mapping_source) values
  ('Fashion-Women', demo_seed.board('fashion-women'), 'auto'),
  ('Fashion-Men', demo_seed.board('fashion-men'), 'auto'),
  ('Curve-Women', demo_seed.board('curve-women'), 'auto'),
  ('Teens-Boys', demo_seed.board('teens-boys'), 'auto'),
  ('Commercial-Women', demo_seed.board('commercial-women'), 'created'),
  ('Commercial-Men', demo_seed.board('commercial-men'), 'created'),
  ('Development-Men', demo_seed.board('development-men'), 'manual'),
  ('Lifestyle', null, 'none');

-- ===========================================================================
-- 16. Talent portal access and memberships
-- ===========================================================================
-- Amara Cole is the demo portal sign-in (her Auth user comes from
-- src/demo/accounts.ts). Four more talent have portal access so Memberships and
-- Talent requests have content; their Auth users exist only as confirmed sign-ups
-- with no password, so nobody can sign in as them.
select demo_seed.act_as('system');
insert into auth.users (id, email, email_confirmed_at, last_sign_in_at, raw_user_meta_data, created_at)
select demo_seed.id('d1', v.n), v.email, demo_seed.ago(v.days_ago), demo_seed.ago(v.seen_ago), jsonb_build_object('full_name', v.full_name), demo_seed.ago(v.days_ago)
from (values
  (2, 'julian.reyes@talent-demo.example', 'Julian Reyes', 210, 6),
  (3, 'sienna.brooks@talent-demo.example', 'Sienna Brooks', 205, 2),
  (5, 'noor.haddad@talent-demo.example', 'Noor Haddad', 120, 1),
  (11, 'imani.okoye@talent-demo.example', 'Imani Okoye', 180, 40)
) as v(n, email, full_name, days_ago, seen_ago);

-- Invitations go through the same function as the Portal tab (audited). Elise was
-- invited and later asked for her access to be removed.
select demo_seed.act_as('daniel');
select public.invite_talent_to_portal(demo_seed.t(v.n), v.email)
from (values
  (1, 'amara.cole@talent-demo.example'), (2, 'julian.reyes@talent-demo.example'), (3, 'sienna.brooks@talent-demo.example'),
  (5, 'noor.haddad@talent-demo.example'), (11, 'imani.okoye@talent-demo.example'), (6, 'elise.fontaine@talent-demo.example')
) as v(n, email);
select public.revoke_talent_portal(demo_seed.t(6));

-- Plans and complimentary memberships. Subscriptions are not required
-- (billing_settings.require_subscription stays off).
select demo_seed.act_as('henry');
update public.subscription_plans set price_cents = 1900, billing_interval = 'month',
  description = 'Full talent portal: profile updates, digitals, availability, bookings and documents.'
where key = 'pro';
insert into public.subscription_plans (key, name, description, price_cents, currency, billing_interval, active, display_order) values
  ('pro-annual', 'Talent Pro (annual)', 'Everything in Talent Pro, billed once a year: two months free.', 19000, 'usd', 'year', true, 2),
  ('founding', 'Founding Member', 'Closed plan for the talent who tested the portal during the pilot.', 0, 'usd', 'year', false, 3);
insert into public.plan_features (plan_key, feature_key) values ('pro-annual', 'portal.full'), ('founding', 'portal.full');

insert into public.talent_subscriptions (talent_id, plan_key, status, provider, current_period_end, cancel_at, note, created_at)
select demo_seed.t(v.n), v.plan_key, v.status, 'manual', now() + v.ends_in * interval '1 day', now() + v.cancel_in * interval '1 day', v.note, demo_seed.ago(v.days_ago)
from (values
  (1, 'pro', 'active', null, null, 'Complimentary: main board talent.', 200),
  (2, 'pro-annual', 'active', 200, null, 'Complimentary for a year while he splits his time with New York.', 165),
  (5, 'pro', 'trialing', 12, null, 'Two-week trial while she tries the portal.', 2),
  (3, 'founding', 'expired', -20, null, 'Portal pilot ended. Renew when memberships launch.', 205),
  (11, 'pro', 'canceled', -5, -5, 'Ended at her request: she prefers email.', 180)
) as v(n, plan_key, status, ends_in, cancel_in, note, days_ago);

-- ===========================================================================
-- 17. Applications (Join Us)
-- ===========================================================================
-- Applications arrive from the form through the server, so they are inserted with
-- no user (the audit log shows them as received); the team then reviews them.
-- Four are new, two are being reviewed: all six can be approved and converted.
select demo_seed.act_as('system');

insert into public.applications (id, source, external_id, status, first_name, last_name, email, phone, date_of_birth, gender, address, city, state, postal_code, country,
  instagram, height_cm, bust_cm, waist_cm, hips_cm, dress_size, shoe_size, hair_color, eye_color, message, guardian_name, guardian_email, guardian_phone,
  sms_consent, sms_consent_text, extra_fields, submitted_at, last_received_at, created_at)
select demo_seed.id('a1', v.n), v.source, v.external_id, 'new', v.first_name, v.last_name, v.email, v.phone, v.dob, v.gender, v.address, v.city, 'TX', v.postal_code, 'United States',
  v.instagram, v.height, v.bust, v.waist, v.hips, v.dress, v.shoe, v.hair, v.eyes, v.message, v.guardian_name, v.guardian_email, v.guardian_phone,
  v.sms, case when v.sms then 'I agree to receive text messages from 42 Model Management about my application. Message and data rates may apply. Reply STOP to opt out.' end,
  v.extra::jsonb, demo_seed.ago(v.days_ago), demo_seed.ago(v.days_ago), demo_seed.ago(v.days_ago)
from (values
  (1, 'ghl', 'demoContact0101', 'Harper', 'Quinn', 'harper.quinn@applicant-demo.example', '(214) 555-0140', demo_seed.born(19, 80), 'Female', '5512 Tanglewood Court', 'Dallas', '75209',
    '@harperquinn.tx', 178, 81, 61, 88, '2', '8.5', 'Light brown', 'Blue',
    'I have been dancing since I was six and did two seasons of student runway at my college. I would love to be considered for your development board.', null, null, null, true,
    '{"How did you hear about us?": "Instagram", "Experience": "Student runway, two seasons", "Available to travel": "Yes"}', 0.3),
  (2, 'ghl', 'demoContact0102', 'Elijah', 'Brandt', 'elijah.brandt@applicant-demo.example', '(817) 555-0141', demo_seed.born(22, 140), 'Male', '2408 Stockyard Bend', 'Fort Worth', '76164',
    null, 188, 97, 78, 95, null, '11', 'Dark blonde', 'Green',
    'A friend who models with you suggested I apply. No experience, but I am comfortable on camera from playing college baseball.', null, null, null, true,
    '{"How did you hear about us?": "Friend or family", "Experience": "None", "Available to travel": "Yes"}', 1.2),
  (3, 'ghl', 'demoContact0103', 'Annika', 'Rao', 'anika.rao@talent-demo.example', '(469) 555-0115', demo_seed.born(19, 100), 'Female', null, 'Irving', '75062',
    '@anika.rao.dfw', 174, 81, 61, 88, '2', '7.5', 'Black', 'Dark brown',
    'I think I am already on your development board? Sending new photos here in case that is the right place for them.', null, null, null, false,
    '{"How did you hear about us?": "Search"}', 2.5),
  (4, 'ghl', 'demoContact0104', 'Lily', 'Castellanos', 'marisa.castellanos@applicant-demo.example', '(972) 555-0143', demo_seed.born(15, 210), 'Female', '918 Duck Creek Lane', 'Garland', '75043',
    null, 168, 78, 60, 84, '0', '7', 'Dark brown', 'Brown',
    'Lily came to your open call last month and has not stopped talking about it. She plays volleyball and is on the honor roll. I am applying on her behalf.',
    'Marisa Castellanos', 'marisa.castellanos@applicant-demo.example', '(972) 555-0143', true,
    '{"How did you hear about us?": "Open call", "School schedule": "Out at 3:30 pm", "Guardian relationship": "Mother"}', 3.6),
  (5, 'ghl', 'demoContact0105', 'Jasmine', 'Whitaker', 'jasmine.whitaker@applicant-demo.example', '(713) 555-0144', demo_seed.born(24, 33), 'Female', '3900 Montrose Garden Street, Apt 7', 'Houston', '77006',
    '@jasmine.whitaker', 176, 83, 63, 90, '4', '9', 'Black', 'Brown',
    'I applied earlier this year and took your advice: these are plain digitals, no filters. Since then I have walked in two local shows and shot a boutique lookbook.', null, null, null, true,
    '{"How did you hear about us?": "Instagram", "Experience": "Two years of local runway, boutique lookbooks", "Available to travel": "Yes"}', 9),
  (6, 'ghl', 'demoContact0106', 'Owen', 'Fitzgerald', 'owen.fitzgerald@applicant-demo.example', '(512) 555-0145', demo_seed.born(27, 260), 'Male', '1701 Zilker Bluff Road', 'Austin', '78704',
    null, 185, 102, 84, 99, null, '10.5', 'Brown', 'Blue',
    'We met at the open call. I host a local radio show and have done a handful of regional commercials. Interested in commercial and voice work.', null, null, null, true,
    '{"How did you hear about us?": "Open call", "Experience": "Regional commercials, radio host", "Available to travel": "Weekdays limited"}', 11),
  (7, 'ghl', 'demoContact0107', 'Sadie', 'Kowalski', 'beth.kowalski@applicant-demo.example', '(469) 555-0146', demo_seed.born(17, 45), 'Female', null, 'Plano', '75023',
    '@sadie.kowalski', 175, 80, 60, 86, '2', '8', 'Blonde', 'Blue',
    'Sadie is seventeen and wants to start modeling before college. Her photos were taken by a friend.', 'Beth Kowalski', 'beth.kowalski@applicant-demo.example', null, false,
    '{"How did you hear about us?": "Friend or family", "Guardian relationship": "Mother"}', 13),
  (8, 'ghl', 'demoContact0108', 'Dominic', 'Reyes-Hall', 'dominic.reyeshall@applicant-demo.example', '(817) 555-0147', demo_seed.born(20, 300), 'Male', '640 Cooper Field Drive', 'Arlington', '76011',
    '@dom.reyeshall', 183, 95, 76, 93, null, '10', 'Black', 'Brown',
    'Streetwear and skate background. Followed Kai for a while and saw he is with you.', null, null, null, true,
    '{"How did you hear about us?": "Instagram", "Experience": "None"}', 15),
  (9, 'manual', null, 'Jasmine', 'Whitaker', 'jasmine.whitaker@applicant-demo.example', '(713) 555-0144', demo_seed.born(24, 33), 'Female', null, 'Houston', '77006',
    '@jasmine.whitaker', 176, null, null, null, null, null, 'Black', 'Brown',
    'Emailed photos to the bookings address; entered by hand.', null, null, null, false, '{}', 240),
  (10, 'ghl', 'demoContact0110', 'Celeste', 'Moreau', 'celeste.moreau@applicant-demo.example', '(214) 555-0148', demo_seed.born(21, 120), 'Female', '2021 Bishop Arts Row, Apt 4', 'Dallas', '75208',
    '@celeste.moreau', 178, 82, 61, 89, '2', '9', 'Red', 'Green',
    'Art student and part-time barista. I have done a few test shoots with photography students and would love a real start.', null, null, null, true,
    '{"How did you hear about us?": "Search", "Experience": "Test shoots", "Available to travel": "Yes"}', 20),
  (11, 'ghl', 'demoContact0111', 'Andre', 'Bellamy', 'andre.bellamy@applicant-demo.example', '(214) 555-0149', demo_seed.born(23, 15), 'Male', '7716 Lakewood Heights Drive', 'Dallas', '75214',
    '@andre.bellamy', 188, 98, 78, 95, null, '11.5', 'Black', 'Brown',
    'Julian Reyes told me to apply. I run track with him on weekends.', null, null, null, true,
    '{"How did you hear about us?": "Friend or family", "Experience": "None", "Available to travel": "Yes"}', 24),
  (12, 'ghl', 'demoContact0112', 'Whitney', 'Sloan', 'whitney.sloan@applicant-demo.example', '(940) 555-0192', demo_seed.born(30, 200), 'Female', null, 'Denton', '76201',
    null, 170, 88, 70, 96, '8', '8', 'Brown', 'Hazel',
    'Interested in commercial and lifestyle work.', null, null, null, false, '{"How did you hear about us?": "Search"}', 70),
  (13, 'ghl', 'demoContact0021', 'Mila', 'Novak', 'mila.novak@talent-demo.example', '(214) 555-0121', demo_seed.born(20, 75), 'Female', '3300 Ashgrove Terrace, Apt 2', 'Dallas', '75214',
    '@mila.novak.dallas', 177, 80, 60, 87, '0', '8.5', 'Ash blonde', 'Grey',
    'I was scouted at a coffee shop years ago and never followed up. Trying now.', null, null, null, true,
    '{"How did you hear about us?": "Instagram", "Experience": "None", "Available to travel": "Yes"}', 34),
  (14, 'ghl', 'demoContact0023', 'Tessa', 'Monroe', 'tessa.monroe@talent-demo.example', '(713) 555-0123', demo_seed.born(18, 290), 'Female', null, 'Houston', '77008',
    null, 173, 82, 62, 89, '2', '8', 'Brown', 'Brown',
    'Registered for Model Expo and filled this in at the same time.', null, null, null, true,
    '{"How did you hear about us?": "Friend or family", "Expo session": "Saturday afternoon"}', 48),
  (15, 'ghl', 'demoContact0118', 'Graham', 'Tully', 'graham.tully@applicant-demo.example', '(210) 555-0197', demo_seed.born(38, 12), 'Male', null, 'San Antonio', '78209',
    null, 180, null, null, null, null, null, 'Grey', 'Blue',
    'Looking for extra work in films.', null, null, null, false, '{"How did you hear about us?": "Search"}', 95)
) as v(n, source, external_id, first_name, last_name, email, phone, dob, gender, address, city, postal_code, instagram, height, bust, waist, hips, dress, shoe, hair, eyes,
       message, guardian_name, guardian_email, guardian_phone, sms, extra, days_ago);

-- Photos saved from the form (private "applications" bucket, <application id>/<kind>-…).
insert into public.application_photos (application_id, kind, storage_path, content_type, size_bytes, status, created_at)
select a.id, k.kind, a.id || '/' || k.kind || '-demo' || k.position || '.jpg', 'image/jpeg', 310000 + (k.position * 97531 + extract(day from a.submitted_at)::int * 8123) % 520000, 'stored', a.submitted_at
from public.applications a
cross join (values ('headshot', 0), ('full_body', 1), ('three_quarter', 2)) as k(kind, position)
where not (k.kind = 'three_quarter' and a.id in (demo_seed.id('a1', 3), demo_seed.id('a1', 4), demo_seed.id('a1', 7), demo_seed.id('a1', 9), demo_seed.id('a1', 12), demo_seed.id('a1', 15)))
  and not (k.kind <> 'headshot' and a.id = demo_seed.id('a1', 8))
  and not (k.kind = 'full_body' and a.id = demo_seed.id('a1', 9));

insert into public.application_photos (application_id, kind, storage_path, source_url, content_type, size_bytes, status, error, created_at)
values (demo_seed.id('a1', 8), 'full_body', null, 'https://files.crm-demo.example/uploads/dominic-full-body.jpg', null, null, 'failed',
  'The file could not be downloaded: the upload link had expired.', demo_seed.ago(15));

-- Review. Status changes stamp the reviewer and are audited by trigger.
select demo_seed.act_as('daniel');
update public.applications set status = 'rejected' where id = demo_seed.id('a1', 9);
update public.applications set status = 'archived' where id = demo_seed.id('a1', 12);
update public.applications set status = 'converted', converted_talent_id = demo_seed.t(21), converted_at = demo_seed.ago(12) where id = demo_seed.id('a1', 13);
update public.applications set status = 'reviewing' where id in (demo_seed.id('a1', 5), demo_seed.id('a1', 6));
update public.applications set status = 'info_requested' where id in (demo_seed.id('a1', 7), demo_seed.id('a1', 8));
update public.applications set status = 'approved' where id = demo_seed.id('a1', 10);
select demo_seed.act_as('olivia');
update public.applications set status = 'rejected' where id = demo_seed.id('a1', 15);
update public.applications set status = 'approved' where id = demo_seed.id('a1', 11);
-- Tessa was linked by the GHL sync when she enrolled, which closes the application.
select demo_seed.act_as('system');
update public.applications set status = 'converted', converted_talent_id = demo_seed.t(23), converted_at = demo_seed.ago(6) where id = demo_seed.id('a1', 14);

-- When each decision was made (the trigger stamps "now").
update public.applications a set reviewed_at = demo_seed.ago(v.days_ago)
from (values (5, 4.5), (6, 6), (7, 10), (8, 12), (9, 236), (10, 3), (11, 4), (12, 40), (13, 12), (15, 80)) as v(n, days_ago)
where a.id = demo_seed.id('a1', v.n);

insert into public.application_notes (application_id, author_id, body, created_at)
select demo_seed.id('a1', v.n), demo_seed.id('d0', v.author), v.body, demo_seed.ago(v.days_ago)
from (values
  (3, 4, 'This is Anika Rao, who is already signed (Women / Development): see possible duplicates. Do not convert. Asked her to send new photos through the portal instead.', 2.2),
  (5, 4, 'Second application: she applied earlier this year (see possible duplicates). Much stronger digitals this time. Booking a video call.', 4.5),
  (5, 1, 'Agreed. If the walk is good, bring her in for the next open call.', 4.1),
  (6, 1, 'Met him at the open call. Commercial look and a great voice. Check his weekday availability before we decide.', 6),
  (7, 4, 'Asked Beth (her mother) for full-length photos without filters and for her own phone number. Waiting to hear back.', 10),
  (8, 4, 'The full-body photo did not come through from the form. Emailed Dominic to send it again.', 12),
  (9, 4, 'Photos heavily filtered and no full-length. Not for us right now; invited to reapply with plain digitals.', 236),
  (10, 4, 'Approved after the video call. Offer the development agreement; first test with Carys Whitlow.', 3),
  (10, 1, 'Yes. Convert once she confirms her start date.', 2.8),
  (11, 1, 'Approved. Referred by Julian Reyes. Strong for the men''s fashion board; convert once he sends his ID.', 4),
  (12, 4, 'Moved to Chicago before we could meet. Archived at her request.', 40),
  (13, 4, 'Great digitals and a very good walk at the open call. Approved and converted to a draft talent.', 12),
  (15, 1, 'Not a fit for our boards. Polite decline sent.', 80)
) as v(n, author, body, days_ago);

-- ===========================================================================
-- 18. Portal activity and the last few days in the office
-- ===========================================================================
-- Availability entered by talent in the portal (and two by staff).
select demo_seed.act_as('system');
insert into public.talent_availability (talent_id, kind, start_on, end_on, note, created_by, created_at)
select demo_seed.t(v.n), v.kind, demo_seed.today() + v.starts, demo_seed.today() + v.ends, v.note, v.created_by, demo_seed.ago(v.days_ago)
from (values
  (1, 'holiday', -40, -36, 'Long weekend away.', demo_seed.id('d0', 8), 60),
  (1, 'unavailable', 20, 23, 'Family wedding in Atlanta.', demo_seed.id('d0', 8), 12),
  (1, 'available', 26, 40, 'Free for travel bookings, including New York.', demo_seed.id('d0', 8), 5),
  (1, 'holiday', 50, 57, 'Holiday with family. Back on the Monday.', demo_seed.id('d0', 8), 5),
  (2, 'unavailable', 6, 7, 'Marathon weekend.', demo_seed.id('d1', 2), 15),
  (2, 'unavailable', 28, 35, 'In New York with Kestrel.', demo_seed.id('d1', 2), 9),
  (3, 'available', 10, 30, 'Open for showroom season and travel.', demo_seed.id('d1', 3), 3),
  (5, 'unavailable', 15, 19, 'Final project reviews at university.', demo_seed.id('d1', 5), 2),
  (11, 'unavailable', 12, 12, 'Family commitment in Houston.', demo_seed.id('d1', 11), 45),
  (8, 'unavailable', 30, 32, 'School trip (entered for Laura).', demo_seed.id('d0', 4), 8),
  (4, 'unavailable', 13, 13, 'Morning only: visa check-in with his attorney.', demo_seed.id('d0', 3), 6)
) as v(n, kind, starts, ends, note, created_by, days_ago);

-- Digitals uploaded by talent from the portal: private until staff approve them.
insert into public.talent_photos (id, talent_id, storage_bucket, storage_path, title, image_type, display_order, portfolio_order, "public", publish_to_website,
  original_file_name, review_status, uploaded_by_talent, source, created_at, updated_at)
select demo_seed.photo(v.t, v.n), demo_seed.t(v.t), 'talent-private', 'talent/' || demo_seed.t(v.t) || '/portal/' || v.file_name, 'Digital from talent', 'digital', v.n, v.n, false, false,
  v.file_name, v.review_status, true, 'portal', demo_seed.ago(v.days_ago), demo_seed.ago(v.days_ago)
from (values
  (3, 8, 'digital-front-new-hair.jpg', 'approved', 16),
  (2, 8, 'digital-gym-mirror.jpg', 'rejected', 11),
  (2, 9, 'digital-front.jpg', 'pending', 2.1),
  (5, 7, 'digital-front.jpg', 'pending', 1.3),
  (5, 8, 'digital-profile.jpg', 'pending', 1.3),
  (1, 10, 'digital-front.jpg', 'pending', 0.4),
  (1, 11, 'digital-full-length.jpg', 'pending', 0.4)
) as v(t, n, file_name, review_status, days_ago);

-- Change requests from the portal. Three are decided through apply_change_request()
-- (which applies the change and audits it); three are waiting in Talent requests.
insert into public.talent_change_requests (id, talent_id, requested_by, field_group, changes, message, created_at)
select demo_seed.id('c7', v.k), demo_seed.t(v.n), v.requested_by, v.field_group, v.changes::jsonb, v.message, demo_seed.ago(v.days_ago)
from (values
  (1, 1, demo_seed.id('d0', 8), 'contact', '{"phone": "(214) 555-0125"}', 'Adding my mother''s landline as a backup number.', 30),
  (2, 3, demo_seed.id('d1', 3), 'measurements', '{"waist_cm": 59, "hips_cm": 86}', 'Measured at home after the show season.', 18),
  (3, 11, demo_seed.id('d1', 11), 'address', '{"address_2": "Apt 11A"}', 'Moved to a bigger apartment in the same building.', 50),
  (4, 1, demo_seed.id('d0', 8), 'social', '{"instagram": "@amaracole"}', null, 8),
  (5, 1, demo_seed.id('d0', 8), 'measurements', '{"waist_cm": 61.5, "hips_cm": 89}', 'Measured at the Solene Atelier fitting last week.', 1.5),
  (6, 2, demo_seed.id('d1', 2), 'address', '{"address_1": "1420 Barton Creek Terrace", "address_2": "Unit 8", "city": "Austin", "state": "TX", "postal_code": "78746"}', 'Moving at the end of the month.', 3),
  (7, 5, demo_seed.id('d1', 5), 'social', '{"instagram": "@noorhaddad.studio"}', 'New handle for my work account.', 0.8)
) as v(k, n, requested_by, field_group, changes, message, days_ago);

select demo_seed.act_as('daniel');
select public.apply_change_request(demo_seed.id('c7', 3), true, null);
select public.apply_change_request(demo_seed.id('c7', 1), true, 'Added. Thanks, Amara.');
select demo_seed.act_as('priya');
select public.apply_change_request(demo_seed.id('c7', 2), false, 'Thanks Sienna. Official measurements are taken at the agency: please book ten minutes with me this week.');
select demo_seed.act_as('system');
update public.talent_change_requests r set reviewed_at = demo_seed.ago(v.days_ago)
from (values (1, 29), (2, 17), (3, 48)) as v(k, days_ago) where r.id = demo_seed.id('c7', v.k);
update public.talent_change_requests set status = 'withdrawn' where id = demo_seed.id('c7', 4);

-- Media review, a comp card and a document download.
select demo_seed.act_as('sofia');
select public.write_audit('media.review_rejected', 'talent', demo_seed.t(2), jsonb_build_object('photo_id', demo_seed.photo(2, 8)));
select public.write_audit('media.review_approved', 'talent', demo_seed.t(3), jsonb_build_object('photo_id', demo_seed.photo(3, 8)));
select demo_seed.act_as('priya');
select public.write_audit('compcard.generated', 'talent', demo_seed.t(3), jsonb_build_object('photos', 4));
select public.write_audit('compcard.generated', 'talent', demo_seed.t(1), jsonb_build_object('photos', 5));
select demo_seed.act_as('henry');
select public.write_audit('document.accessed', 'talent', demo_seed.t(4), jsonb_build_object('document_id', demo_seed.id('dc', 10)));

-- This week on the booking desk: Halden & Rowe confirmed, Summit Mile moved their
-- wrap time, and the showroom fitting call sheet went out.
select demo_seed.act_as('priya');
update public.bookings set status = 'confirmed', notes = 'Confirmed by Meredith from the Spring Preview package. Thirty looks; hair and makeup at 7:30.' where id = demo_seed.id('b0', 16);
update public.bookings set end_at = demo_seed.at(18, '15:00') where id = demo_seed.id('b0', 19);
select demo_seed.act_as('henry');
update public.booking_financials set notes = 'Second reminder sent to Ines Navarro. Promised by the end of the week.' where booking_id = demo_seed.id('b0', 3);

-- What Amara did in the portal today.
select demo_seed.act_as('amara');
select public.write_audit('portal.document_downloaded', 'talent', demo_seed.t(1), jsonb_build_object('document_id', demo_seed.id('dc', 5)));
select public.write_audit('portal.digital_uploaded', 'talent', demo_seed.t(1));

-- ===========================================================================
-- 19. Timeline
-- ===========================================================================
-- Everything above ran in one moment, so two "when" columns are spread over the
-- past weeks to make the workspace read as lived-in. Nothing else is touched.
select demo_seed.act_as('system');

-- Audit log: the order of this file is the order things happened, from the
-- workspace being set up three months ago to the portal upload a few minutes ago.
with ordered as (
  select id, row_number() over (order by ctid) as position, count(*) over () as total from public.audit_logs
)
update public.audit_logs a
set created_at = now() - (129600 * power(1 - o.position::numeric / o.total, 2.2)) * interval '1 minute'
from ordered o
where a.id = o.id;

-- talent.updated_at is set to now() by a trigger on every write. Only this column
-- is corrected, with triggers paused for this single statement.
set session_replication_role = replica;
update public.talent t set updated_at = demo_seed.ago(coalesce(v.days_ago, 6 + (extract(epoch from t.created_at)::bigint / 86400 * 7) % 50))
from (select tt.id, x.days_ago from public.talent tt left join (values
  (1, 0.02), (5, 0.8), (2, 2.1), (20, 1.6), (21, 0.9), (3, 3.2), (23, 5.5), (22, 14), (24, 80)
) as x(n, days_ago) on tt.id = demo_seed.t(x.n)) v
where v.id = t.id;
set session_replication_role = origin;

-- ===========================================================================
-- 99. Clean up
-- ===========================================================================
select demo_seed.act_as('system');
drop schema demo_seed cascade;
