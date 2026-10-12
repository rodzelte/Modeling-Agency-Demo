-- 013: Boards hierarchy and assignment auditing.
--
-- Boards form a tree (parent_board_id). Each board has a path_segment that is unique
-- among its siblings; its public URL is the chain of segments, e.g. /models/teens/boys.
-- Existing boards (which carry legacy category/section columns) are arranged under
-- one parent per category. No board or assignment rows are deleted.

alter table public.boards
  add column if not exists website_section text,
  add column if not exists path_segment text,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

-- Parent boards for each legacy category that has boards but no parent yet.
insert into public.boards (category, section, name, slug, is_minor_board, display_order, sort_order, is_active,
                           publish_to_website, internal_only, show_in_navigation)
select c.category, 'root', initcap(c.category), c.category, bool_and(c.is_minor_board), min(c.sort_order), min(c.sort_order),
       true, bool_or(c.publish_to_website), false, true
from public.boards c
where c.parent_board_id is null
  and c.category is not null and c.category not in ('', 'general')
  and not exists (select 1 from public.boards p where p.slug = c.category)
group by c.category;

update public.boards child
set parent_board_id = parent.id
from public.boards parent
where child.parent_board_id is null
  and parent.slug = child.category
  and child.id <> parent.id
  and child.category not in ('', 'general');

-- Segment: the legacy section for children, the slug for top-level boards. Duplicates
-- among siblings get a numeric suffix so the uniqueness rule below can hold.
with ranked as (
  select id,
         coalesce(nullif(lower(regexp_replace(case when parent_board_id is null then slug else section end, '[^a-zA-Z0-9]+', '-', 'g')), ''), slug) as segment,
         row_number() over (
           partition by parent_board_id, coalesce(nullif(lower(regexp_replace(case when parent_board_id is null then slug else section end, '[^a-zA-Z0-9]+', '-', 'g')), ''), slug)
           order by created_at, id) as rn
  from public.boards
  where path_segment is null
)
update public.boards b
set path_segment = case when r.rn = 1 then r.segment else r.segment || '-' || r.rn end
from ranked r
where b.id = r.id;

create or replace function public.prepare_board()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ancestor uuid;
  depth int := 0;
begin
  new.slug := lower(trim(new.slug));
  new.path_segment := lower(coalesce(nullif(trim(new.path_segment), ''), new.slug));
  if new.path_segment !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Board URL segment may contain only lowercase letters, numbers, and hyphens';
  end if;
  -- Legacy slugs are left alone unless they are being changed.
  if (tg_op = 'INSERT' or new.slug is distinct from lower(trim(old.slug))) and new.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Board slug may contain only lowercase letters, numbers, and hyphens';
  end if;

  -- Reject cycles and runaway depth.
  ancestor := new.parent_board_id;
  while ancestor is not null loop
    if ancestor = new.id then
      raise exception 'A board cannot be nested inside itself';
    end if;
    depth := depth + 1;
    if depth > 5 then
      raise exception 'Boards can be nested at most 5 levels deep';
    end if;
    select parent_board_id into ancestor from public.boards where id = ancestor;
  end loop;

  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end;
$$;

drop trigger if exists prepare_board on public.boards;
create trigger prepare_board before insert or update on public.boards
  for each row execute procedure public.prepare_board();

alter table public.boards alter column path_segment set not null;
create unique index if not exists boards_sibling_segment_idx
  on public.boards (coalesce(parent_board_id, '00000000-0000-0000-0000-000000000000'::uuid), path_segment);
create index if not exists boards_parent_idx on public.boards (parent_board_id, sort_order);

-- Full URL path of a board ("teens/boys").
create or replace function public.board_path(target uuid)
returns text language sql stable security definer set search_path = public as $$
  with recursive chain as (
    select id, parent_board_id, path_segment, 0 as depth from public.boards where id = target
    union all
    select b.id, b.parent_board_id, b.path_segment, c.depth + 1
    from public.boards b join chain c on b.id = c.parent_board_id
    where c.depth < 6
  )
  select string_agg(path_segment, '/' order by depth desc) from chain;
$$;

-- Reorder siblings: sort_order follows the array order. Runs as the caller, so the
-- boards.manage RLS policy decides whether it may.
create or replace function public.reorder_boards(board_ids uuid[])
returns void language sql security invoker set search_path = public as $$
  update public.boards b
  set sort_order = o.position, display_order = o.position
  from unnest(board_ids) with ordinality as o(id, position)
  where b.id = o.id;
$$;
revoke execute on function public.reorder_boards(uuid[]) from public, anon;
grant execute on function public.reorder_boards(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Assignments
-- ---------------------------------------------------------------------------
alter table public.talent_board_assignments add column if not exists created_by uuid references auth.users(id) on delete set null;
create index if not exists talent_board_assignments_talent_idx on public.talent_board_assignments (talent_id);

create or replace function public.audit_board_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  row_data public.talent_board_assignments;
begin
  row_data := case when tg_op = 'DELETE' then old else new end;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), case when tg_op = 'DELETE' then 'board.removed' else 'board.assigned' end, 'talent', row_data.talent_id,
          jsonb_build_object('board_id', row_data.board_id, 'board_path', public.board_path(row_data.board_id)));
  return null;
end;
$$;

drop trigger if exists audit_board_assignment on public.talent_board_assignments;
create trigger audit_board_assignment after insert or delete on public.talent_board_assignments
  for each row execute procedure public.audit_board_assignment();

create or replace function public.audit_board_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ordering_fields text[] := array['sort_order', 'display_order', 'updated_at', 'updated_by'];
begin
  -- Reordering alone is not worth an audit row per board.
  if tg_op = 'UPDATE' and (to_jsonb(new) - ordering_fields) = (to_jsonb(old) - ordering_fields) then
    return null;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (
    auth.uid(),
    'board.' || case tg_op when 'INSERT' then 'created' when 'DELETE' then 'deleted' else 'updated' end,
    'boards',
    coalesce(new.id, old.id),
    case when tg_op <> 'INSERT' then jsonb_build_object('name', old.name, 'slug', old.slug, 'parent_board_id', old.parent_board_id, 'is_active', old.is_active, 'publish_to_website', old.publish_to_website, 'internal_only', old.internal_only) end,
    case when tg_op <> 'DELETE' then jsonb_build_object('name', new.name, 'slug', new.slug, 'parent_board_id', new.parent_board_id, 'is_active', new.is_active, 'publish_to_website', new.publish_to_website, 'internal_only', new.internal_only) end
  );
  return null;
end;
$$;

drop trigger if exists audit_board_change on public.boards;
create trigger audit_board_change after insert or update or delete on public.boards
  for each row execute procedure public.audit_board_change();
