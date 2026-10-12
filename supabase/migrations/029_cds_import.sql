-- Phase 20: CDS / WebForFashion import (staging). Additive and idempotent.
--
-- CDS (go.cdsglobal.com) is the agency's previous booking system; its media
-- (photos, digitals, videos, portfolios) live in WebForFashion. The owner's
-- browser reads both with the owner's own sign-in and hands the data to
-- Dashboard → CDS Import, which stores it here under the owner's session.
-- Nothing here is public. Banking, legal, medical, passwords and notes are
-- never collected.
--
-- cds_talents   one row per CDS talent; talent_id links it to ONE dashboard talent
-- cds_media     every photo / digital / video, imported into talent_photos later
-- cds_portfolio_boards  CDS portfolio name ("Fashion-Women") -> website board

create table if not exists public.cds_talents (
  cds_id text primary key,
  wff_id text unique,
  first_name text not null default '',
  last_name text not null default '',
  email text,
  phone text,
  gender text,
  location text,
  -- General / stats / skills as read from CDS and WebForFashion (allow-listed keys).
  profile jsonb not null default '{}'::jsonb,
  -- CDS General -> Boards (e.g. "Women Mainboard"); kept separate from portfolios.
  cds_boards text[] not null default '{}',
  -- [{ "id": "9944101", "name": "Fashion-Women", "website": true, "media": ["8904239", …] }]
  portfolios jsonb not null default '[]'::jsonb,
  talent_id uuid unique references public.talent(id) on delete set null,
  match_status text not null default 'pending',
  match_reason text,
  excluded boolean not null default false,
  extracted_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cds_talents_status_check check (match_status in ('pending', 'matched', 'created', 'review', 'skipped'))
);
create index if not exists cds_talents_status_idx on public.cds_talents (match_status);

create table if not exists public.cds_media (
  wff_media_id text primary key,
  cds_id text not null references public.cds_talents(cds_id) on delete cascade,
  kind text not null default 'image',
  position integer not null default 0,
  -- Board, type of work, photographer, web flag, size … whatever CDS provides.
  metadata jsonb not null default '{}'::jsonb,
  photo_id uuid references public.talent_photos(id) on delete set null,
  status text not null default 'listed',
  error text,
  extracted_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint cds_media_kind_check check (kind in ('image', 'digital', 'video')),
  constraint cds_media_status_check check (status in ('listed', 'imported', 'failed', 'skipped'))
);
create index if not exists cds_media_talent_idx on public.cds_media (cds_id, kind, position);
create index if not exists cds_media_status_idx on public.cds_media (status);

create table if not exists public.cds_portfolio_boards (
  portfolio_name text primary key,
  board_id uuid references public.boards(id) on delete set null,
  mapping_source text not null default 'auto',
  updated_at timestamptz not null default now(),
  constraint cds_portfolio_boards_source_check check (mapping_source in ('auto', 'created', 'manual', 'none'))
);

alter table public.cds_talents enable row level security;
alter table public.cds_media enable row level security;
alter table public.cds_portfolio_boards enable row level security;
revoke all on public.cds_talents, public.cds_media, public.cds_portfolio_boards from anon;

drop policy if exists "integration viewers read cds talents" on public.cds_talents;
-- Contact details and dates of birth: also requires talent.private.view.
create policy "integration viewers read cds talents" on public.cds_talents for select to authenticated
  using (public.has_permission('integrations.view') and public.has_permission('talent.private.view'));
drop policy if exists "integration managers write cds talents" on public.cds_talents;
create policy "integration managers write cds talents" on public.cds_talents for all to authenticated
  using (public.has_permission('integrations.manage')) with check (public.has_permission('integrations.manage'));

drop policy if exists "integration viewers read cds media" on public.cds_media;
create policy "integration viewers read cds media" on public.cds_media for select to authenticated
  using (public.has_permission('integrations.view'));
drop policy if exists "integration managers write cds media" on public.cds_media;
create policy "integration managers write cds media" on public.cds_media for all to authenticated
  using (public.has_permission('integrations.manage')) with check (public.has_permission('integrations.manage'));

drop policy if exists "integration viewers read cds portfolio boards" on public.cds_portfolio_boards;
create policy "integration viewers read cds portfolio boards" on public.cds_portfolio_boards for select to authenticated
  using (public.has_permission('integrations.view'));
drop policy if exists "integration managers write cds portfolio boards" on public.cds_portfolio_boards;
create policy "integration managers write cds portfolio boards" on public.cds_portfolio_boards for all to authenticated
  using (public.has_permission('integrations.manage')) with check (public.has_permission('integrations.manage'));

-- Linking a CDS record to a talent is audited (who, which talent, how matched).
create or replace function public.audit_cds_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.talent_id is distinct from old.talent_id then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), case when new.talent_id is null then 'cds.unlinked' else 'cds.linked' end, 'talent',
            coalesce(new.talent_id, old.talent_id),
            jsonb_build_object('cds_id', new.cds_id, 'match_status', new.match_status, 'match_reason', new.match_reason));
  end if;
  return new;
end;
$$;
revoke execute on function public.audit_cds_link() from public, anon, authenticated;
drop trigger if exists audit_cds_link on public.cds_talents;
create trigger audit_cds_link after update of talent_id on public.cds_talents
  for each row execute procedure public.audit_cds_link();
