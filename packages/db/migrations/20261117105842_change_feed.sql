-- Changes report (issue #472): what changed on the initiatives of a workspace in a period, from the audit log, readable by every member
-- (the audit table itself is admin-only). The twin of weekly_item_changes (0015) and item_activity (0014).
-- Returns one row per changed field of: Initiative Phase, Initiative Status, Health and Build Status (rows of items), and the status of the
-- linked GitHub issue (item_github_links.gh_state) and Jira issue (item_jira_links.jira_status), each mapped to the initiative that owns the link.
-- A link's first value (old is null) is not a change and is left out. Commercial fields are never returned. Actors are returned as ids; the app
-- names them through tenant_directory. "at" is the time Product Velocity registered the change.
-- No new table. Functions replaced by this migration: none. No DROP statements.
create function public.change_feed(p_tenant uuid, p_from timestamptz, p_to timestamptz)
returns table (id bigint, item_id uuid, entity text, field text, old jsonb, new jsonb, at timestamptz, actor_id uuid, via text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_tenant <> all (array (select public.my_tenant_ids())) then
    raise exception 'You are not a member of that workspace.' using errcode = '42501';
  end if;
  return query
    select a.id,
           case a.entity when 'items' then a.entity_id when 'item_jira_links' then jl.item_id else gl.item_id end,
           a.entity, a.field, a.old, a.new, a.at, a.actor_id, a.via
    from public.audit_log a
    left join public.item_jira_links jl on a.entity = 'item_jira_links' and jl.id = a.entity_id and jl.tenant_id = p_tenant
    left join public.item_github_links gl on a.entity = 'item_github_links' and gl.id = a.entity_id and gl.tenant_id = p_tenant
    where a.tenant_id = p_tenant and a.at >= p_from and a.at < p_to
      and ((a.entity = 'items' and a.field in ('initiative_phase', 'initiative_status', 'health', 'status'))
        or (a.entity = 'item_jira_links' and a.field = 'jira_status' and a.old is not null and jl.item_id is not null)
        or (a.entity = 'item_github_links' and a.field = 'gh_state' and a.old is not null and gl.item_id is not null))
    order by a.at desc, a.id desc
    limit 5000;
end $$;
revoke all on function public.change_feed(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.change_feed(uuid, timestamptz, timestamptz) to authenticated;
