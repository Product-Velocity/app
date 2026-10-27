-- 0046: delivery measures of the field dictionary that need data from GitHub (issue #35):
--   blocked_issues (N36), stale_issues (N37), gh_iteration (N34), gh_target_date (N35).
-- All four are read-only in the app: signed-in users have no write grant on them, only the server writes them, through the two
-- functions below, which write only when the value differs and are audited with the source "GitHub webhook".
-- 1. github_apply_tree_counts(): the number of open child issues that are blocked and that are stale. The counting rule lives in
--    @pv/domain (countBlockedStale); the database stores what the server worked out after reading the tree.
-- 2. github_apply_board_status() also takes the board's iteration (sprint) title and the board's date field. The same signature, so
--    create or replace: a caller that does not send them leaves them empty. Only initiatives with a link on the connection are touched.
-- No DROP statements: applied to Supabase through a tool that pauses on them.
alter table public.items
  add column blocked_issues integer check (blocked_issues is null or blocked_issues >= 0),
  add column stale_issues integer check (stale_issues is null or stale_issues >= 0),
  add column gh_iteration text check (gh_iteration is null or char_length(gh_iteration) <= 100),
  add column gh_target_date date;

create function public.github_apply_tree_counts(p_connection uuid, p_item uuid, p_blocked integer, p_stale integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if p_blocked is null or p_blocked < 0 or p_stale is null or p_stale < 0 then raise exception 'bad counts' using errcode = '22023'; end if;
  perform set_config('app.via', 'GitHub webhook', true);
  update public.items i set blocked_issues = p_blocked, stale_issues = p_stale
   where i.id = p_item and i.deleted_at is null
     and exists (select 1 from public.item_github_links l where l.item_id = i.id and l.connection_id = p_connection)
     and (i.blocked_issues is distinct from p_blocked or i.stale_issues is distinct from p_stale);
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.github_apply_tree_counts(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.github_apply_tree_counts(uuid, uuid, integer, integer) to service_role;

-- p_rows: [{item_id, status, board_item_id, iteration, target_date}]
create or replace function public.github_apply_board_status(p_connection uuid, p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if not exists (select 1 from public.github_connections c where c.id = p_connection) then
    raise exception 'Unknown connection.' using errcode = '22023';
  end if;
  perform set_config('app.via', 'GitHub webhook', true);
  update public.item_github_links l set project_item_id = n.board_item_id
    from jsonb_to_recordset(p_rows) as n(item_id uuid, status text, board_item_id text, iteration text, target_date date)
   where l.item_id = n.item_id and l.connection_id = p_connection and n.board_item_id is not null and l.project_item_id is distinct from n.board_item_id;
  update public.items i set gh_project_status = left(n.status, 100), gh_iteration = left(n.iteration, 100), gh_target_date = n.target_date, last_synced_at = now()
    from jsonb_to_recordset(p_rows) as n(item_id uuid, status text, board_item_id text, iteration text, target_date date)
   where i.id = n.item_id and i.deleted_at is null
     and exists (select 1 from public.item_github_links l where l.item_id = i.id and l.connection_id = p_connection)
     and (i.gh_project_status is distinct from left(n.status, 100) or i.gh_iteration is distinct from left(n.iteration, 100) or i.gh_target_date is distinct from n.target_date);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
