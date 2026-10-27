-- 0038: which GitHub Project board each child issue (epic or task) has been added to, R-037 step 2.
-- item_issue_tree is a server-written cache (see 0024); the two columns say "this child is on that board", so a push adds
-- only the children that are not on the linked board yet. A different board id means "not on the current board".
-- No DROP statements: applied to Supabase through a tool that pauses on them.
alter table public.item_issue_tree
  add column board_id text check (board_id is null or char_length(board_id) <= 100),
  add column board_item_id text check (board_item_id is null or char_length(board_item_id) <= 100);

-- Server only (service role). p_nodes: [{repo, number, board_item_id}]. The initiative must belong to the connection.
create function public.github_record_board_items(p_connection uuid, p_item uuid, p_board_id text, p_nodes jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if not exists (select 1 from public.item_github_links l where l.connection_id = p_connection and l.item_id = p_item) then
    raise exception 'That initiative is not linked to this connection.' using errcode = '22023';
  end if;
  update public.item_issue_tree t set board_id = p_board_id, board_item_id = n.board_item_id
    from jsonb_to_recordset(p_nodes) as n(repo text, number integer, board_item_id text)
   where t.item_id = p_item and t.repo_full_name = n.repo and t.issue_number = n.number;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.github_record_board_items(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.github_record_board_items(uuid, uuid, text, jsonb) to service_role;
