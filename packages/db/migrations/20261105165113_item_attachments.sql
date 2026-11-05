-- Issue #325, slice B: files (item_files) and links (item_links) become one table, item_attachments, kind 'file' or 'link'.
-- Written documents stay in item_documents (versions and approval). The dictionary fields Screenshots (files) and Artifacts (links) stay as
-- they are: they are two views of this one table, so the field dictionary and the grid columns do not change.
--
-- Sharing: `shared` (default true) means "goes into the GitHub issue / Jira description". For a file the login-free link (share_token) exists exactly
-- when shared is true; the trigger below makes the token (never the client) and removes it when sharing is switched off. Links have no token.
--
-- Functions replaced (rewritten from their current definition, only the table references change): mcp_apply, mcp_undo_last,
-- copy_items_to_project, item_activity. Audit rows written before this migration keep the entity names item_links / item_files; undo and the
-- activity feed still understand them.
-- Rollback: forward-only. To go back, copy the rows into new item_links / item_files tables by kind.

create table public.item_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  item_id uuid not null,
  kind text not null check (kind in ('file', 'link')),
  name text not null default '' check (char_length(name) <= 200),
  url text,
  file_kind text check (file_kind in ('screenshot', 'image', 'document')),
  storage_path text,
  mime_type text check (mime_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf')),
  size_bytes integer check (size_bytes between 1 and 10485760),
  shared boolean not null default true,
  share_token text check (share_token ~ '^[A-Za-z0-9_-]{32,64}$'),
  share_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'MCP', 'GitHub webhook', 'import', 'system')),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade,
  constraint item_attachments_shape check (
    (kind = 'link' and url ~* '^https?://' and char_length(url) <= 2000 and storage_path is null and file_kind is null and mime_type is null and size_bytes is null and share_token is null)
    or
    (kind = 'file' and url is null and char_length(btrim(name)) between 1 and 200 and storage_path is not null and char_length(storage_path) <= 500 and file_kind is not null)
  )
);
create index item_attachments_item_idx on public.item_attachments (tenant_id, item_id);
create unique index item_attachments_share_token_key on public.item_attachments (share_token) where share_token is not null;

-- existing rows keep their ids (so old audit rows still point at them) and their sharing: a file is shared when it had a link
insert into public.item_attachments (id, tenant_id, item_id, kind, name, url, shared, created_at, updated_at, created_by, created_via)
select id, tenant_id, item_id, 'link', label, url, true, created_at, updated_at, created_by, created_via from public.item_links;
insert into public.item_attachments (id, tenant_id, item_id, kind, name, file_kind, storage_path, mime_type, size_bytes, shared, share_token, share_updated_at, created_at, updated_at, created_by, created_via)
select id, tenant_id, item_id, 'file', name, kind, storage_path, mime_type, size_bytes, share_token is not null, share_token, share_updated_at, created_at, updated_at, created_by, created_via from public.item_files;

-- the token is made here, never taken from the client
create function public.item_attachments_share() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind = 'link' then
    new.share_token := null;
    new.share_updated_at := null;
  elsif new.shared then
    if tg_op = 'INSERT' or new.share_token is null or new.share_token is distinct from old.share_token then
      new.share_token := left(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 43); -- 172 random bits, the same length as before
      new.share_updated_at := now();
    end if;
  elsif new.share_token is not null then
    new.share_token := null;
    new.share_updated_at := now();
  end if;
  return new;
end $$;
create function public.item_attachments_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind is distinct from old.kind or new.storage_path is distinct from old.storage_path then
    raise exception 'An attachment cannot change its kind or its stored file';
  end if;
  return new;
end $$;

create trigger item_attachments_a_immutable before update on public.item_attachments for each row execute function public.item_attachments_immutable();
create trigger item_attachments_b_share before insert or update on public.item_attachments for each row execute function public.item_attachments_share();
create trigger a_platform_readonly_guard before insert or update or delete on public.item_attachments
  for each row execute function platform.readonly_guard();
create trigger item_attachments_meta before insert or update on public.item_attachments for each row execute function public.set_write_meta();
create trigger item_attachments_audit after insert or update or delete on public.item_attachments for each row execute function public.audit_row();

alter table public.item_attachments enable row level security;
create policy item_attachments_select on public.item_attachments for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy item_attachments_insert on public.item_attachments for insert to authenticated
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy item_attachments_update on public.item_attachments for update to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())))
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy item_attachments_delete on public.item_attachments for delete to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())));

revoke all on public.item_attachments from public, anon, authenticated;
grant select on public.item_attachments to authenticated;
grant insert (id, tenant_id, item_id, kind, name, url, file_kind, storage_path, mime_type, size_bytes, shared) on public.item_attachments to authenticated;
grant update (name, url, shared, share_token) on public.item_attachments to authenticated;
grant delete on public.item_attachments to authenticated;

-- ---------------------------------------------------------------------------
-- Functions that named the old tables: rewrite their current definition, and stop if a piece of text is not found.
-- ---------------------------------------------------------------------------
create function pg_temp.rewrite_fn(p_sig text, p_pairs text[]) returns void
language plpgsql as $$
declare d text; i int;
begin
  d := pg_get_functiondef(p_sig::regprocedure);
  for i in 1 .. array_length(p_pairs, 1) by 2 loop
    if position(p_pairs[i] in d) = 0 then
      raise exception 'rewrite of % failed: text not found: %', p_sig, p_pairs[i];
    end if;
    d := replace(d, p_pairs[i], p_pairs[i + 1]);
  end loop;
  execute d;
end $$;

select pg_temp.rewrite_fn('public.mcp_apply(text, jsonb, boolean, uuid, uuid)', array[
  $a$public.item_links l where l.tenant_id = v_tenant and l.item_id = v_item and l.url = v_val ->> 'url' and l.label = coalesce(v_val ->> 'label', '')$a$,
  $b$public.item_attachments l where l.kind = 'link' and l.tenant_id = v_tenant and l.item_id = v_item and l.url = v_val ->> 'url' and l.name = coalesce(v_val ->> 'label', '')$b$,
  $a$insert into public.item_links (tenant_id, item_id, label, url) values (v_tenant, v_item, coalesce(v_val ->> 'label', ''), v_val ->> 'url')$a$,
  $b$insert into public.item_attachments (tenant_id, item_id, kind, name, url) values (v_tenant, v_item, 'link', coalesce(v_val ->> 'label', ''), v_val ->> 'url')$b$,
  $a$delete from public.item_links where tenant_id = v_tenant$a$,
  $b$delete from public.item_attachments where kind = 'link' and tenant_id = v_tenant$b$,
  $a$or label = v_val ->> 'label'$a$,
  $b$or name = v_val ->> 'label'$b$
]);

select pg_temp.rewrite_fn('public.mcp_undo_last(uuid)', array[
  $a$'item_links', 'a link'$a$,
  $b$'item_links', 'a link', 'item_attachments', 'a link'$b$,
  -- links only: a file's bytes live in Storage, so a file add or removal is never undone from here (as before)
  $a$l.entity in ('item_tags', 'item_links', 'item_relations', 'item_teams')$a$,
  $b$(l.entity in ('item_tags', 'item_links', 'item_relations', 'item_teams') or (l.entity = 'item_attachments' and not exists (select 1 from public.audit_log k where k.change_set_id = prev.id and k.entity = 'item_attachments' and k.entity_id = l.entity_id and k.field = 'kind' and coalesce(k.new, k.old) #>> '{}' = 'file')))$b$,
  $a$execute format('delete from public.%I where id = $1 and tenant_id = $2', e.entity)$a$,
  $b$execute format('delete from public.%I where id = $1 and tenant_id = $2', case when e.entity = 'item_links' then 'item_attachments' else e.entity end)$b$,
  $a$elsif e.entity = 'item_links' then$a$,
  $b$elsif e.entity in ('item_links', 'item_attachments') then$b$,
  $a$insert into public.item_links (id, tenant_id, item_id, label, url) values (e.entity_id, prev.tenant_id, (v_old ->> 'item_id')::uuid, coalesce(v_old ->> 'label', ''), v_old ->> 'url')$a$,
  $b$insert into public.item_attachments (id, tenant_id, item_id, kind, name, url) values (e.entity_id, prev.tenant_id, (v_old ->> 'item_id')::uuid, 'link', coalesce(v_old ->> 'label', v_old ->> 'name', ''), v_old ->> 'url')$b$
]);

select pg_temp.rewrite_fn('public.copy_items_to_project(uuid[], uuid)', array[
  $a$insert into public.item_links (tenant_id, item_id, label, url) select v_tenant, v_new, l.label, l.url from public.item_links l where l.item_id = v_id$a$,
  $b$insert into public.item_attachments (tenant_id, item_id, kind, name, url, shared) select v_tenant, v_new, 'link', l.name, l.url, l.shared from public.item_attachments l where l.kind = 'link' and l.item_id = v_id$b$
]);

select pg_temp.rewrite_fn('public.item_activity(uuid, integer)', array[
  $a$'item_links', 'item_files'$a$,
  $b$'item_links', 'item_files', 'item_attachments'$b$
]);

drop table public.item_links;
drop table public.item_files;
