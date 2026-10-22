-- 0014: the Activity tab of the item panel (issue #26).
-- audit_log is readable by admins only. Everybody who can read an item may read that item's history, so this function
-- returns the audit rows about one item and its related rows (tags, links, files, relations, teams).
-- Rows of related tables carry their item in the field "item_id" of their create or delete row, which is how they are found.
-- No DROP statements: applied to Supabase through a tool that pauses on them.
create function public.item_activity(p_item uuid, p_limit integer default 200)
returns table (id bigint, at timestamptz, entity text, entity_id uuid, field text, old jsonb, new jsonb, actor_id uuid, via text)
language plpgsql stable security definer set search_path = '' as $$
declare t uuid;
begin
  select i.tenant_id into t from public.items i where i.id = p_item;
  if t is null or t <> all (array (select public.my_tenant_ids())) then
    raise exception 'That item does not exist or you cannot read it.' using errcode = '42501';
  end if;
  return query
    select a.id, a.at, a.entity, a.entity_id, a.field, a.old, a.new, a.actor_id, a.via
    from public.audit_log a
    where a.tenant_id = t
      and a.field not in ('tenant_id', 'created_at', 'created_by', 'created_via', 'updated_at')
      and (
        (a.entity = 'items' and a.entity_id = p_item)
        or (a.entity in ('item_tags', 'item_links', 'item_files', 'item_relations', 'item_teams')
            and a.entity_id in (
              select x.entity_id from public.audit_log x
              where x.tenant_id = t and x.field = 'item_id' and x.entity in ('item_tags', 'item_links', 'item_files', 'item_relations', 'item_teams')
                and (x.new #>> '{}' = p_item::text or x.old #>> '{}' = p_item::text)))
      )
    order by a.at desc, a.id desc
    limit greatest(1, least(coalesce(p_limit, 200), 1000));
end $$;
revoke all on function public.item_activity(uuid, integer) from public, anon;
grant execute on function public.item_activity(uuid, integer) to authenticated;
