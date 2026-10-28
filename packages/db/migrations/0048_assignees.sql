-- 0048: assignees, both ways (issue #35).
-- 1. tenant_members.github_username: the GitHub login of a member, unique per workspace (case ignored). A person sets their own; an admin
--    can set anyone's, through set_github_username(). It is only used to match people with the assignees of the tracking issue.
-- 2. items.assignee_ids: the people assigned in Product Velocity (members of the same workspace). Written only through
--    set_item_assignees() (creators and admins, members of the workspace only) or the server's sync; audited like any edit.
-- 3. item_github_links.gh_assignees: the logins GitHub shows on the tracking issue now, written by the server only.
-- 4. sync_base_valid() also accepts the key "assignees" (a hash, as for the other compared values).
-- 5. github_apply_assignees(): the server stores what GitHub shows (only when it differs).
--    github_pull_assignees(): the people a person chose to take over from GitHub (Keep GitHub), for creators and admins, with the audit
--    actor and the agreed base; the logins must belong to members of the workspace, nothing is created from GitHub.
-- No DROP statements: applied to Supabase through a tool that pauses on them.
alter table public.tenant_members
  add column github_username text check (github_username is null or github_username ~ '^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$');
create unique index tenant_members_github_username on public.tenant_members (tenant_id, lower(github_username)) where github_username is not null;

create function public.set_github_username(p_tenant uuid, p_user uuid, p_username text) returns void
language plpgsql security definer set search_path = '' as $$
declare v text := nullif(btrim(coalesce(p_username, '')), '');
begin
  if v is not null then v := ltrim(v, '@'); end if;
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not (auth.uid() = p_user or public.is_tenant_admin(p_tenant)) then
    raise exception 'You can set your own GitHub username; an admin can set anyone''s.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tenant_members m where m.tenant_id = p_tenant and m.user_id = p_user) then
    raise exception 'That person is not a member of this workspace.' using errcode = 'P0002';
  end if;
  if v is not null and v !~ '^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$' then
    raise exception 'That is not a GitHub username.' using errcode = '22023';
  end if;
  update public.tenant_members set github_username = v where tenant_id = p_tenant and user_id = p_user;
end $$;
revoke all on function public.set_github_username(uuid, uuid, text) from public, anon;
grant execute on function public.set_github_username(uuid, uuid, text) to authenticated;

alter table public.items add column assignee_ids uuid[] not null default '{}' check (cardinality(assignee_ids) <= 10);
alter table public.item_github_links add column gh_assignees text[] not null default '{}';

create function public.set_item_assignees(p_item uuid, p_user_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_ids uuid[];
begin
  select tenant_id into v_tenant from public.items where id = p_item and deleted_at is null;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.tenant_members m where m.tenant_id = v_tenant and m.user_id = auth.uid() and m.role in ('creator', 'admin') and not m.is_service_account) then
    raise exception 'Only a creator or admin can change assignees.' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct u order by u), '{}') into v_ids from unnest(coalesce(p_user_ids, '{}')) as u;
  if cardinality(v_ids) > 10 then raise exception 'At most 10 people can be assigned.' using errcode = '22023'; end if;
  if exists (select 1 from unnest(v_ids) as u where not exists (select 1 from public.tenant_members m where m.tenant_id = v_tenant and m.user_id = u)) then
    raise exception 'Only members of this workspace can be assigned.' using errcode = '22023';
  end if;
  update public.items set assignee_ids = v_ids where id = p_item and assignee_ids is distinct from v_ids;
end $$;
revoke all on function public.set_item_assignees(uuid, uuid[]) from public, anon;
grant execute on function public.set_item_assignees(uuid, uuid[]) to authenticated;

create or replace function public.sync_base_valid(b jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select b is null or (
    jsonb_typeof(b) = 'object'
    and not exists (select 1 from jsonb_each_text(b) e where e.key not in ('title', 'summary', 'description', 'hypothesis', 'priority', 'group', 'due', 'size', 'assignees') or e.value !~ '^[0-9a-f]{64}$')
  )
$$;

create function public.github_apply_assignees(p_connection uuid, p_item uuid, p_logins text[]) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
  v text[];
begin
  select coalesce(array_agg(distinct lower(btrim(x)) order by lower(btrim(x))), '{}') into v from unnest(coalesce(p_logins, '{}')) as x where btrim(x) <> '';
  if cardinality(v) > 50 then v := v[1:50]; end if;
  perform set_config('app.via', 'GitHub webhook', true);
  update public.item_github_links l set gh_assignees = v
   where l.item_id = p_item and l.connection_id = p_connection and l.gh_assignees is distinct from v
     and exists (select 1 from public.items i where i.id = l.item_id and i.deleted_at is null);
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.github_apply_assignees(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.github_apply_assignees(uuid, uuid, text[]) to service_role;

create function public.github_pull_assignees(p_actor uuid, p_item uuid, p_user_ids uuid[], p_base jsonb) returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_old uuid[];
  v_ids uuid[];
begin
  select tenant_id, assignee_ids into v_tenant, v_old from public.items where id = p_item and deleted_at is null for update;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.tenant_members m where m.tenant_id = v_tenant and m.user_id = p_actor and m.role in ('creator', 'admin') and not m.is_service_account) then
    raise exception 'Only a creator or admin can take over assignees from GitHub.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.item_github_links l where l.tenant_id = v_tenant and l.item_id = p_item and l.mode = 'push' and l.issue_number is not null) then
    raise exception 'This item has no GitHub issue that can be synced.' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(distinct u order by u), '{}') into v_ids from unnest(coalesce(p_user_ids, '{}')) as u;
  if cardinality(v_ids) > 10 then raise exception 'At most 10 people can be assigned.' using errcode = '22023'; end if;
  if exists (select 1 from unnest(v_ids) as u where not exists (select 1 from public.tenant_members m where m.tenant_id = v_tenant and m.user_id = u)) then
    raise exception 'Only members of this workspace can be assigned.' using errcode = '22023';
  end if;
  perform set_config('request.jwt.claim.sub', p_actor::text, true); -- the audit log records the person who chose
  update public.items set assignee_ids = v_ids where id = p_item and assignee_ids is distinct from v_ids;
  if p_base is not null then perform public.github_record_base(p_actor, p_item, p_base); end if;
  return v_old; -- what was replaced, for the record
end $$;
revoke all on function public.github_pull_assignees(uuid, uuid, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.github_pull_assignees(uuid, uuid, uuid[], jsonb) to service_role;
