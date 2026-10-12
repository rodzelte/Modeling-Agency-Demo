-- 018: Function privileges (Supabase advisor lints 0011, 0028, 0029).
--
-- Trigger functions are never called through the API: Postgres fires triggers
-- without checking EXECUTE, so revoking it only removes the /rest/v1/rpc surface.
-- Role helpers are needed by signed-in users' RLS policies but not by anonymous
-- visitors. talent_public_age() stays callable by anon because the public views
-- (security_invoker) call it as the visitor; it returns only an opt-in age.

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'agency_members_after_change()', 'agency_members_bind_user()', 'agency_members_protect_owner()',
    'audit_board_assignment()', 'audit_board_change()', 'audit_sensitive_change()', 'audit_talent_publication()',
    'check_collection_photo()', 'enforce_talent_permissions()', 'handle_auth_user_updated()', 'handle_new_profile()',
    'prepare_board()', 'stamp_created_by()', 'stamp_updated_by()', 'stamp_uploaded_by()', 'touch_private_details()',
    'digital_book_published_at()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
  end loop;

  foreach fn in array array['has_role(text)', 'has_any_role(text[])', 'is_active_agency_member()', 'board_path(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end;
$$;

alter function public.digital_book_published_at() set search_path = public;
