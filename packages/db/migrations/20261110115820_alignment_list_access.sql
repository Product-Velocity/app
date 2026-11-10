-- Issue #392: the Alignment tab. Who may read which alignment sessions, decided by the database and not only by the page (Ashu, 2026-11-10):
--   admins read every session (drafts and open ones included); everyone else reads ONLY closed or archived sessions that allow results (show_results).
--   This also closes #400: a member could read results_snapshot of a session whose results are off; now a non-admin reads only sessions where the
--   results are allowed, so the stored results are readable exactly where docs/19 says members may see them.
-- Changes four existing select policies in place with ALTER POLICY (no drop of anything):
--   alignment_sessions_select   admins: all; members: closed or archived with show_results
--   alignment_items_select      the initiatives of a session follow the session (a member cannot list the initiatives of a draft)
--   alignment_mailings_select   admins only (invitation and reminder texts say a session exists; docs/19 had "members read the state")
--   alignment_rank_applications_select   admins only (whether and when a vote was applied is an admin figure on the tab)
-- New function alignment_session_stats(tenant): ADMINS ONLY (others get no rows). Per session: people invited, people who voted (totals, never per
--   group), whether an invitation or reminder is written and waiting for a confirm, the latest application of the vote to the Stack Rank that was not
--   undone and whether one was undone. Reads personal-data tables only to count them; returns no name, email or ballot.
-- No DROP statements.
alter policy alignment_sessions_select on public.alignment_sessions
  using (
    tenant_id = any (array (select public.my_admin_tenant_ids()))
    or (tenant_id = any (array (select public.my_tenant_ids())) and status in ('closed', 'archived') and show_results)
  );

alter policy alignment_items_select on public.alignment_items
  using (
    tenant_id = any (array (select public.my_tenant_ids()))
    and session_id in (select s.id from public.alignment_sessions s where s.tenant_id = alignment_items.tenant_id)
  );

alter policy alignment_mailings_select on public.alignment_mailings
  using (tenant_id = any (array (select public.my_admin_tenant_ids())));

alter policy alignment_rank_applications_select on public.alignment_rank_applications
  using (tenant_id = any (array (select public.my_admin_tenant_ids())));

create function public.alignment_session_stats(p_tenant uuid)
returns table (session_id uuid, invited integer, voted integer, mailing_draft boolean, applied_at timestamptz, applied_moved integer, undone boolean)
language sql stable security definer set search_path = '' as $$
  select s.id,
         (select count(*)::integer from public.alignment_participants p where p.session_id = s.id and p.tenant_id = s.tenant_id and p.invited_at is not null),
         (select count(*)::integer from public.alignment_ballots b where b.session_id = s.id and b.tenant_id = s.tenant_id and b.state = 'submitted'),
         exists (select 1 from public.alignment_mailings m where m.session_id = s.id and m.tenant_id = s.tenant_id and m.status = 'draft'),
         a.created_at,
         a.moved,
         (a.id is null and exists (select 1 from public.alignment_rank_applications u where u.session_id = s.id and u.tenant_id = s.tenant_id and u.undone_at is not null))
    from public.alignment_sessions s
    left join lateral (
      select x.id, x.created_at, x.moved from public.alignment_rank_applications x
       where x.session_id = s.id and x.tenant_id = s.tenant_id and x.undone_at is null
       order by x.created_at desc limit 1
    ) a on true
   where s.tenant_id = p_tenant
     and p_tenant = any (array (select public.my_admin_tenant_ids()));
$$;
revoke all on function public.alignment_session_stats(uuid) from public, anon;
grant execute on function public.alignment_session_stats(uuid) to authenticated;
