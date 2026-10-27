-- 0037: link a PV project to an organisation-owned GitHub Project (the board), R-037.
-- projects.github_board: which board, and how PV's fields map to the board's fields (set by admins in Settings > GitHub).
-- item_github_links.project_item_id: the item of the board that holds this initiative's issue, so a second push never adds it twice.
-- No DROP statements: applied to Supabase through a tool that pauses on them.
alter table public.projects add column github_board jsonb
  check (github_board is null or (jsonb_typeof(github_board) = 'object' and octet_length(github_board::text) <= 20000));
grant update (github_board) on public.projects to authenticated;

alter table public.item_github_links add column project_item_id text check (project_item_id is null or char_length(project_item_id) <= 100);

-- Only the server (service role) records the board item, on behalf of the person who confirmed the push.
create function public.github_record_project_item(p_actor uuid, p_item uuid, p_project_item_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.items where id = p_item and deleted_at is null;
  if v_tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.tenant_members m
    where m.tenant_id = v_tenant and m.user_id = p_actor and m.role in ('creator', 'admin') and not m.is_service_account
  ) then
    raise exception 'Only a creator or admin can push an item to GitHub.' using errcode = '42501';
  end if;
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  update public.item_github_links set project_item_id = p_project_item_id where tenant_id = v_tenant and item_id = p_item and mode = 'push';
end $$;
revoke all on function public.github_record_project_item(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.github_record_project_item(uuid, uuid, text) to service_role;
