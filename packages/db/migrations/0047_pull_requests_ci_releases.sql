-- 0047: pull requests, CI and releases of an initiative (issue #35): open_prs (N29), merged_prs (N31), ci_status, latest_release and
-- repositories of the field dictionary. All five are read-only in the app: signed-in users have no write grant on them, only the
-- server writes them, through github_apply_extras(), which writes only when something differs and is audited with the source
-- "GitHub webhook". The server reads GitHub (never writes to it) and works out the values with the rules of @pv/github.
-- ci_status is Passing, Failing or None (checks on the default branch of the primary repository); p_ci null leaves the value as it was
-- (a run in progress is neither passing nor failing).
-- No DROP statements: applied to Supabase through a tool that pauses on them.
alter table public.items
  add column open_prs integer check (open_prs is null or open_prs >= 0),
  add column merged_prs integer check (merged_prs is null or merged_prs >= 0),
  add column ci_status text check (ci_status is null or ci_status in ('Passing', 'Failing', 'None')),
  add column latest_release text check (latest_release is null or char_length(latest_release) <= 200),
  add column repositories text check (repositories is null or char_length(repositories) <= 500);

create function public.github_apply_extras(p_connection uuid, p_item uuid, p_open integer, p_merged integer, p_ci text, p_release text, p_repos text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if p_open is null or p_open < 0 or p_merged is null or p_merged < 0 then raise exception 'bad counts' using errcode = '22023'; end if;
  if p_ci is not null and p_ci not in ('Passing', 'Failing', 'None') then raise exception 'bad ci status' using errcode = '22023'; end if;
  perform set_config('app.via', 'GitHub webhook', true);
  update public.items i set
    open_prs = p_open, merged_prs = p_merged,
    ci_status = coalesce(p_ci, i.ci_status),
    latest_release = left(p_release, 200),
    repositories = left(nullif(p_repos, ''), 500)
   where i.id = p_item and i.deleted_at is null
     and exists (select 1 from public.item_github_links l where l.item_id = i.id and l.connection_id = p_connection)
     and (i.open_prs is distinct from p_open or i.merged_prs is distinct from p_merged or i.ci_status is distinct from coalesce(p_ci, i.ci_status)
          or i.latest_release is distinct from left(p_release, 200) or i.repositories is distinct from left(nullif(p_repos, ''), 500));
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.github_apply_extras(uuid, uuid, integer, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.github_apply_extras(uuid, uuid, integer, integer, text, text, text) to service_role;
