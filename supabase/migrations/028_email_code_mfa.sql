-- Phase 19b: emailed 6-digit code as the second sign-in step (owner decision,
-- 2026-10-02: the team's custom-domain mailboxes have no authenticator set up).
-- Additive and idempotent.
--
-- Supabase has no email MFA factor, so the code is a normal email OTP sign-in
-- (it starts a new session). On its own that would let anyone holding the
-- mailbox skip the password, so a code counts only when:
--   1. start_email_mfa() was called from a PASSWORD session of the same user; it
--      returns a one-time nonce the app keeps in an httpOnly cookie (only its
--      hash is stored), and
--   2. complete_email_mfa(nonce) is called within 10 minutes from the new OTP
--      session, with that nonce.
-- The OTP session is then recorded and trusted for 30 days (email_mfa_verified).
-- All access goes through these functions; the tables have RLS and no policies.

create table if not exists public.mfa_email_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nonce_hash text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
create index if not exists mfa_email_challenges_user_idx on public.mfa_email_challenges (user_id, created_at desc);
alter table public.mfa_email_challenges enable row level security;
revoke all on public.mfa_email_challenges from anon, authenticated;

create table if not exists public.mfa_email_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  verified_at timestamptz not null default now()
);
create index if not exists mfa_email_sessions_user_idx on public.mfa_email_sessions (user_id);
alter table public.mfa_email_sessions enable row level security;
revoke all on public.mfa_email_sessions from anon, authenticated;

-- True when the caller's session was signed in with the given method within
-- p_max_age seconds (JWT "amr" claim: [{"method": "password", "timestamp": …}]).
create or replace function public.session_signed_in_with(p_method text, p_max_age integer)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) as entry
    where entry->>'method' = p_method
      and (entry->>'timestamp')::bigint >= extract(epoch from now())::bigint - p_max_age
  );
$$;

create or replace function public.start_email_mfa()
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  caller uuid := auth.uid();
  nonce text := gen_random_uuid()::text || gen_random_uuid()::text;
begin
  if caller is null or not public.is_active_agency_member() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- Only a fresh password sign-in may ask for a code.
  if not public.session_signed_in_with('password', 3600) then
    raise exception 'sign in with your password first' using errcode = '42501';
  end if;
  if (select count(*) from public.mfa_email_challenges where user_id = caller and created_at > now() - interval '15 minutes') >= 5 then
    raise exception 'too many codes requested' using errcode = '54000';
  end if;
  insert into public.mfa_email_challenges (user_id, nonce_hash)
  values (caller, encode(sha256(convert_to(nonce, 'UTF8')), 'hex'));
  return nonce;
end;
$$;

create or replace function public.complete_email_mfa(p_nonce text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  caller uuid := auth.uid();
  v_session uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
  challenge uuid;
begin
  if caller is null or v_session is null or p_nonce is null then return false; end if;
  if not public.session_signed_in_with('otp', 600) then return false; end if;
  select id into challenge from public.mfa_email_challenges
  where user_id = caller and used_at is null and created_at > now() - interval '10 minutes'
    and nonce_hash = encode(sha256(convert_to(p_nonce, 'UTF8')), 'hex')
  order by created_at desc limit 1
  for update;
  if challenge is null then return false; end if;
  update public.mfa_email_challenges set used_at = now() where id = challenge;
  insert into public.mfa_email_sessions (session_id, user_id) values (v_session, caller)
  on conflict (session_id) do update set verified_at = now() where public.mfa_email_sessions.user_id = caller;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id)
  values (caller, 'auth.email_code_verified', 'auth_users', caller);
  return true;
end;
$$;

create or replace function public.email_mfa_verified()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.mfa_email_sessions
    where user_id = auth.uid()
      and session_id = nullif(auth.jwt()->>'session_id', '')::uuid
      and verified_at > now() - interval '30 days'
  );
$$;

revoke execute on function public.session_signed_in_with(text, integer) from public, anon, authenticated;
revoke execute on function public.start_email_mfa() from public, anon;
revoke execute on function public.complete_email_mfa(text) from public, anon;
revoke execute on function public.email_mfa_verified() from public, anon;
grant execute on function public.start_email_mfa() to authenticated;
grant execute on function public.complete_email_mfa(text) to authenticated;
grant execute on function public.email_mfa_verified() to authenticated;
