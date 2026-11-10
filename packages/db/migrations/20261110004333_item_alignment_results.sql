-- Issue #393: what the crowd said about an initiative (item panel Alignment tab and the Crowd Rank, Crowd Score, Consensus and Votes columns).
-- item_alignment_results(p_tenant, p_item): one row per closed or archived session that included the item, newest first, read from the
--   stored results_snapshot (aggregates only, docs/19 section 8c). Nothing is recomputed and nothing personal is read.
--   Who sees a row: workspace admins always; other members only when the session allows participants to see the results (show_results).
--   Draft and open sessions give no row. p_item null = every initiative of the workspace (the grid reads this once).
--   consensus = 100 minus the gap between the group that rates the item highest and the one that rates it lowest (groups of 5 or more
--   voters only, as stored); null when the snapshot shows no groups, so a small group can never be worked out from it.
--   voters is the total for the session, never per group.
-- New function only: no table, no replaced function, no DROP.
create function public.item_alignment_results(p_tenant uuid, p_item uuid default null)
returns table (
  item_id uuid, session_id uuid, session_name text, method text, closed_at timestamptz,
  place integer, tied boolean, score numeric, of_items integer, voters integer,
  contested boolean, high_group text, low_group text, spread numeric, consensus numeric
)
language sql stable security definer set search_path = '' as $$
  select ai.item_id, s.id, s.name, s.method, coalesce(s.closed_at, s.updated_at),
         (j.j ->> 'place')::integer, coalesce((j.j ->> 'tied')::boolean, false), (j.j ->> 'score')::numeric,
         jsonb_array_length(s.results_snapshot -> 'results' -> 'joint'), coalesce((s.results_snapshot ->> 'voters')::integer, 0),
         c.c is not null, c.c ->> 'highGroup', c.c ->> 'lowGroup', (c.c ->> 'spread')::numeric,
         g.consensus
    from public.alignment_sessions s
    join public.alignment_items ai on ai.session_id = s.id and ai.tenant_id = s.tenant_id
    cross join lateral (
      select e as j from jsonb_array_elements(s.results_snapshot -> 'results' -> 'joint') e where e ->> 'itemId' = ai.id::text limit 1
    ) j
    left join lateral (
      select e as c from jsonb_array_elements(coalesce(s.results_snapshot -> 'results' -> 'contested', '[]'::jsonb)) e where e ->> 'itemId' = ai.id::text limit 1
    ) c on true
    left join lateral (
      select case when count(*) >= 2 then round(100 - (max(sc) - min(sc)), 2) end as consensus
        from (
          select (x ->> 'score')::numeric as sc
            from jsonb_array_elements(case when jsonb_typeof(s.results_snapshot -> 'results' -> 'groups') = 'array' then s.results_snapshot -> 'results' -> 'groups' else '[]'::jsonb end) grp,
                 jsonb_array_elements(grp -> 'scores') x
           where x ->> 'itemId' = ai.id::text
        ) z
    ) g on true
   where s.tenant_id = p_tenant
     and p_tenant = any (array (select public.my_tenant_ids()))
     and s.status in ('closed', 'archived')
     and s.results_snapshot is not null
     and ai.item_id is not null
     and (p_item is null or ai.item_id = p_item)
     and (s.show_results or p_tenant = any (array (select public.my_admin_tenant_ids())))
   order by coalesce(s.closed_at, s.updated_at) desc, s.id;
$$;
revoke all on function public.item_alignment_results(uuid, uuid) from public, anon;
grant execute on function public.item_alignment_results(uuid, uuid) to authenticated;
