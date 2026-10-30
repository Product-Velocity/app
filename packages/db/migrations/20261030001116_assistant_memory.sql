-- 20261030001116_assistant_memory: memory for AI assistants (Claude, ChatGPT, Gemini) and the assistant label of a connection
-- (docs/27-AI-ASSISTANTS-AND-MEMORY.md; a new request, see docs/requests/).
--
-- 1. public.assistant_of(client_name): which assistant a connected OAuth client is. Mirrors detectAssistant() in packages/domain (a test keeps
--    them in step). mcp_connections.assistant is generated from it, so the Connect page and the audit can say "ChatGPT" or "Gemini".
--    The write source stays 'Claude MCP' for every OAuth-issued token: it means "an AI assistant connector", all of them under the same guards
--    (they cannot approve, rank, decide, value, or confirm anything).
-- 2. ai_memories: short sourced notes an assistant saves and finds again in later sessions, scope workspace / group / item. Assistants write
--    drafts only; a person confirms. A confirmed note can only be archived by a person, and an assistant's change to it sends it back to draft.
--    Archive instead of delete; an admin can delete for good (privacy, retention). Audited (actor, source, time, old and new value).
--    Never read for a GitHub payload (rule 2): memory is in no allowlist.
-- No function is replaced.

create function public.assistant_of(p_name text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case
    when lower(coalesce(p_name, '')) ~ 'claude|anthropic' then 'claude'
    when lower(coalesce(p_name, '')) ~ 'chatgpt|openai|gpt' then 'chatgpt'
    when lower(coalesce(p_name, '')) ~ 'gemini|google' then 'gemini'
    else 'other'
  end
$$;
grant execute on function public.assistant_of(text) to authenticated;

alter table public.mcp_connections
  add column assistant text generated always as (public.assistant_of(client_name)) stored;

-- ------------------------------------------------------------------------------------------------
create table public.ai_memories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  scope text not null default 'workspace' check (scope in ('workspace', 'group', 'item')),
  group_name text check (group_name is null or char_length(btrim(group_name)) between 1 and 200),
  item_id uuid,
  kind text not null check (kind in ('fact', 'term', 'partner', 'research', 'preference', 'lesson', 'open_question')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  source text not null check (char_length(btrim(source)) between 1 and 300),
  basis text not null check (basis in ('person', 'source', 'document')),
  tags text[] not null default '{}' check (cardinality(tags) <= 8),
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'archived')),
  ai_draft boolean not null default false,
  version integer not null default 1 check (version >= 1),
  verified_at timestamptz not null default now(),
  assistant text check (assistant is null or assistant in ('claude', 'chatgpt', 'gemini', 'other')),
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  constraint ai_memories_scope_ref check (
    (scope = 'workspace' and group_name is null and item_id is null)
    or (scope = 'group' and group_name is not null and item_id is null)
    or (scope = 'item' and item_id is not null and group_name is null)
  ),
  constraint ai_memories_confirmed check ((status = 'confirmed') = (confirmed_at is not null)),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade
);

-- recall loads the live notes of one workspace; the unique index keeps one live note per title and place
create index ai_memories_tenant_idx on public.ai_memories (tenant_id, status, scope, updated_at desc);
create unique index ai_memories_one_live_title on public.ai_memories (
  tenant_id, scope, coalesce(lower(group_name), ''), coalesce(item_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(title)
) where status <> 'archived';

create function public.ai_memories_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ai boolean := public.write_source() = 'Claude MCP';
  v_client text := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id', '');
  v_changed boolean;
begin
  if tg_op = 'DELETE' then
    if v_ai then
      raise exception 'An AI assistant cannot delete notes; it can archive a draft one' using errcode = 'PV004';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if (select count(*) from public.ai_memories m where m.tenant_id = new.tenant_id and m.status <> 'archived') >= 1000 then
      raise exception 'This workspace already keeps 1,000 notes. Archive some under Settings, Memory first.' using errcode = 'PV005';
    end if;
    new.version := 1;
    new.status := 'draft';
    new.confirmed_by := null;
    new.confirmed_at := null;
    new.ai_draft := v_ai;
    new.verified_at := now();
    new.assistant := case when v_ai then coalesce((select c.assistant from public.mcp_connections c
        where c.user_id = auth.uid() and c.client_id = v_client and c.revoked_at is null limit 1), 'other') else null end;
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id or new.scope is distinct from old.scope
     or new.group_name is distinct from old.group_name or new.item_id is distinct from old.item_id then
    raise exception 'A note cannot move to another workspace, group or initiative; save a new one instead';
  end if;
  new.assistant := old.assistant;
  new.ai_draft := old.ai_draft;
  v_changed := (new.kind, new.title, new.body, new.source, new.basis, new.tags) is distinct from (old.kind, old.title, old.body, old.source, old.basis, old.tags);

  if v_ai and new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    raise exception 'An AI assistant cannot confirm a note; a person does' using errcode = 'PV004';
  end if;
  if v_ai and new.status = 'archived' and old.status = 'confirmed' then
    raise exception 'A person confirmed this note, so only a person can archive it' using errcode = 'PV004';
  end if;

  if v_changed then
    new.version := old.version + 1;
    new.verified_at := now();
    if v_ai then
      new.ai_draft := true;
      if new.status = 'confirmed' then new.status := 'draft'; end if; -- an assistant's change always needs a person again
    else
      new.ai_draft := false; -- a person edited it, so it is no longer an unreviewed draft
    end if;
  else
    new.version := old.version;
    if new.verified_at is distinct from old.verified_at then new.verified_at := now(); end if;
  end if;

  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    new.confirmed_by := auth.uid();
    new.confirmed_at := now();
    new.ai_draft := false;
  elsif new.status = 'confirmed' then
    new.confirmed_by := old.confirmed_by;
    new.confirmed_at := old.confirmed_at;
  else
    new.confirmed_by := null;
    new.confirmed_at := null;
  end if;
  return new;
end $$;

create trigger ai_memories_a_meta before insert or update on public.ai_memories
  for each row execute function public.set_write_meta();
create trigger ai_memories_b_guard before insert or update or delete on public.ai_memories
  for each row execute function public.ai_memories_guard();
create trigger ai_memories_audit after insert or update or delete on public.ai_memories
  for each row execute function public.audit_row();
create trigger a_platform_readonly_guard before insert or update or delete on public.ai_memories
  for each row execute function platform.readonly_guard();

-- RLS (fast policy pattern, spike S7): everyone in the workspace reads; editors write drafts and confirm; admins delete for good.
alter table public.ai_memories enable row level security;
create policy ai_memories_select on public.ai_memories for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy ai_memories_insert on public.ai_memories for insert to authenticated
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy ai_memories_update on public.ai_memories for update to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())))
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy ai_memories_delete on public.ai_memories for delete to authenticated
  using (tenant_id = any (array (select public.my_admin_tenant_ids())));

revoke all on public.ai_memories from public, anon, authenticated;
grant select, delete on public.ai_memories to authenticated;
grant insert (tenant_id, scope, group_name, item_id, kind, title, body, source, basis, tags) on public.ai_memories to authenticated;
grant update (kind, title, body, source, basis, tags, status, verified_at) on public.ai_memories to authenticated;

revoke all on function public.ai_memories_guard() from public, anon, authenticated;
