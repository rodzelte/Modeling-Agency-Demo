-- Supabase Postgres logs showed "duplicate key value violates unique constraint
-- ghl_sync_jobs_open_idx" every few hours: a webhook and the hourly sync queued
-- the same GHL contact at the same moment. The app already recovered, but each
-- collision was logged as an error. Queueing now happens in one statement that
-- skips contacts already queued (ON CONFLICT on the one-open-job index) and makes
-- a failed job due again. Server only (secret key), like ghl_claim_jobs.
create or replace function public.ghl_enqueue_jobs(p_kind text, p_ids text[], p_reason text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  queued integer;
begin
  update public.ghl_sync_jobs set next_attempt_at = now(), updated_at = now()
  where kind = p_kind and status = 'failed' and external_id = any(p_ids);

  insert into public.ghl_sync_jobs (kind, external_id, reason)
  select p_kind, id, left(p_reason, 200) from (select distinct unnest(p_ids) as id) ids
  on conflict (kind, external_id) where status in ('pending', 'running', 'failed') do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$$;
revoke execute on function public.ghl_enqueue_jobs(text, text[], text) from public, anon, authenticated;
grant execute on function public.ghl_enqueue_jobs(text, text[], text) to service_role;
