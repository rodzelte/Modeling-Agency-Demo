-- Supabase performance advisor (auth_rls_initplan): these policies called
-- auth.uid() once per row. Wrapping it as (select auth.uid()) evaluates it once
-- per query. Same rules, same results: only the evaluation changes.

drop policy if exists "agency users can update own name" on public.profiles;
create policy "agency users can update own name" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "agency users can view own profile" on public.profiles;
create policy "agency users can view own profile" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.has_any_role(array['owner','administrator']));

drop policy if exists "agency members can view own membership" on public.agency_members;
create policy "agency members can view own membership" on public.agency_members for select to authenticated
  using (user_id = (select auth.uid()) or public.has_permission('team.manage'));

drop policy if exists "application managers add notes" on public.application_notes;
create policy "application managers add notes" on public.application_notes for insert to authenticated
  with check (public.has_permission('applications.manage') and author_id = (select auth.uid()));

drop policy if exists "agency users can view own roles" on public.profile_roles;
create policy "agency users can view own roles" on public.profile_roles for select to authenticated
  using (profile_id = (select auth.uid()) or public.has_any_role(array['owner','administrator']));

drop policy if exists "assignees update own tasks" on public.tasks;
create policy "assignees update own tasks" on public.tasks for update to authenticated
  using (assignee_id = (select auth.uid()) and public.has_permission('dashboard.access'))
  with check (assignee_id = (select auth.uid()));

drop policy if exists "members add own tasks" on public.tasks;
create policy "members add own tasks" on public.tasks for insert to authenticated
  with check (public.has_permission('dashboard.access') and assignee_id = (select auth.uid()));

drop policy if exists "task readers read tasks" on public.tasks;
create policy "task readers read tasks" on public.tasks for select to authenticated
  using (public.has_permission('operations.view') or (assignee_id = (select auth.uid()) and public.has_permission('dashboard.access')));
