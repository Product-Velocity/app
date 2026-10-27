-- 0040: Delivery Status (field N33, key gh_project_status): the board status of an initiative, read from the linked GitHub Project.
-- items.gh_project_status is read-only in the app: signed-in users have no write grant on it, only the server writes it, through
-- github_apply_board_status(), which writes only when the value differs (nothing new, nothing written) and is audited with the source
-- "GitHub webhook". It is the board's own word (Backlog, Ready, In progress, On staging, Done ...), separate from Build Status
-- (items.status, the issue's state) and Initiative Status (set by people).
-- The function also keeps item_github_links.project_item_id up to date, so an initiative that was already on the board (pulled in from an
-- existing issue) shows which board it is on.
-- No DROP statements: applied to Supabase through a tool that pauses on them.
alter table public.items add column gh_project_status text check (gh_project_status is null or char_length(gh_project_status) <= 100);

-- p_rows: [{item_id, status, board_item_id}]. Only initiatives that have a link on this connection are touched.
create function public.github_apply_board_status(p_connection uuid, p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if not exists (select 1 from public.github_connections c where c.id = p_connection) then
    raise exception 'Unknown connection.' using errcode = '22023';
  end if;
  perform set_config('app.via', 'GitHub webhook', true);
  update public.item_github_links l set project_item_id = n.board_item_id
    from jsonb_to_recordset(p_rows) as n(item_id uuid, status text, board_item_id text)
   where l.item_id = n.item_id and l.connection_id = p_connection and n.board_item_id is not null and l.project_item_id is distinct from n.board_item_id;
  update public.items i set gh_project_status = left(n.status, 100), last_synced_at = now()
    from jsonb_to_recordset(p_rows) as n(item_id uuid, status text, board_item_id text)
   where i.id = n.item_id and i.deleted_at is null
     and exists (select 1 from public.item_github_links l where l.item_id = i.id and l.connection_id = p_connection)
     and i.gh_project_status is distinct from left(n.status, 100);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.github_apply_board_status(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.github_apply_board_status(uuid, jsonb) to service_role;
