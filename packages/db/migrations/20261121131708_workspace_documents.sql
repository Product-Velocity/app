-- Issue #565, slice 3 (PV skills): documents that belong to the workspace, not to one initiative (vision, strategy, north star,
-- competitive analysis, personas, weekly update, release notes, quarter plan). Same rules as item_documents (0055 and the AI tool and model
-- of 20261030091015): versioned Markdown, never read for a GitHub payload, an AI draft when written through an assistant, approval only by an
-- Approver and never by Claude (PV004). The company profile stays in company_profiles; one Documents list shows both.
-- New tables only: no existing table or function is changed.

create table public.workspace_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null default 'other'
    check (kind in ('vision', 'strategy', 'north_star', 'competitive', 'personas', 'weekly_update', 'release_notes', 'quarter_plan', 'other')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text not null default '' check (char_length(body) <= 200000),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved')),
  version integer not null default 1 check (version >= 1),
  ai_draft boolean not null default false,
  ai_tool text check (ai_tool is null or ai_tool in ('claude', 'chatgpt', 'gemini', 'other')),
  ai_model text check (ai_model is null or char_length(btrim(ai_model)) between 1 and 80),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'GitHub webhook', 'import', 'system', 'MCP')),
  constraint workspace_documents_approval check ((status = 'approved') = (approved_at is not null))
);
create index workspace_documents_tenant_idx on public.workspace_documents (tenant_id, kind, updated_at desc);

create table public.workspace_document_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  document_id uuid not null references public.workspace_documents (id) on delete cascade,
  version integer not null,
  title text not null,
  body text not null,
  saved_at timestamptz not null default now(),
  saved_by uuid references auth.users (id) on delete set null,
  saved_via text not null default 'system',
  ai_tool text check (ai_tool is null or ai_tool in ('claude', 'chatgpt', 'gemini', 'other')),
  ai_model text check (ai_model is null or char_length(btrim(ai_model)) between 1 and 80),
  unique (document_id, version)
);
create index workspace_document_versions_doc_idx on public.workspace_document_versions (tenant_id, document_id, version);

create function public.workspace_documents_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_claude boolean := public.write_source() = 'MCP';
  v_approver boolean;
  v_content boolean;
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.status := case when new.status = 'approved' then 'draft' else new.status end;
    new.approved_by := null;
    new.approved_at := null;
    if v_claude then
      new.ai_draft := true;
      new.ai_tool := coalesce(public.current_assistant(), 'other');
      new.ai_model := nullif(btrim(new.ai_model), '');
    else
      new.ai_tool := null;
      new.ai_model := null;
    end if;
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'A document cannot move to another workspace';
  end if;

  if v_claude then
    if new.ai_draft is distinct from old.ai_draft then
      raise exception 'Claude cannot accept or reject an AI draft; a person does' using errcode = 'PV004';
    end if;
    if new.status = 'approved' and old.status is distinct from 'approved' then
      raise exception 'Claude cannot approve a document; an Approver does' using errcode = 'PV004';
    end if;
  end if;

  v_content := new.title is distinct from old.title or new.body is distinct from old.body;
  if v_content then
    new.version := old.version + 1;
    if old.status = 'approved' and new.status = 'approved' then
      new.status := 'in_review';
    end if;
  else
    new.version := old.version;
  end if;

  if v_claude and v_content then
    new.ai_tool := coalesce(public.current_assistant(), 'other');
    new.ai_model := nullif(btrim(new.ai_model), '');
  else
    new.ai_tool := old.ai_tool;
    new.ai_model := old.ai_model;
  end if;

  if new.status = 'approved' and old.status is distinct from 'approved' then
    select exists (
      select 1 from public.tenant_members m
       where m.tenant_id = new.tenant_id and m.user_id = auth.uid() and m.status = 'active'
         and m.is_approver and not m.is_service_account
    ) into v_approver;
    if not coalesce(v_approver, false) then
      raise exception 'Only an Approver can approve a document' using errcode = 'PV004';
    end if;
    new.approved_by := auth.uid();
    new.approved_at := now();
    new.ai_draft := false;
  elsif new.status is distinct from 'approved' then
    new.approved_by := null;
    new.approved_at := null;
  else
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
  end if;
  return new;
end $$;

create function public.workspace_documents_save_version() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ai boolean := public.write_source() = 'MCP';
begin
  if tg_op = 'INSERT' or new.version is distinct from old.version then
    insert into public.workspace_document_versions (tenant_id, document_id, version, title, body, saved_by, saved_via, ai_tool, ai_model)
    values (new.tenant_id, new.id, new.version, new.title, new.body, auth.uid(), public.write_source(),
            case when v_ai then new.ai_tool end, case when v_ai then new.ai_model end);
  end if;
  return null;
end $$;

-- Audit without the text: the versions table holds it, and the audit log should not carry document contents twice.
create function public.workspace_documents_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_row jsonb := case when tg_op = 'DELETE' then v_old else v_new end;
  k text;
  o jsonb;
  n jsonb;
begin
  for k in
    select key from (select jsonb_object_keys(v_old) as key union select jsonb_object_keys(v_new)) s
    where key <> 'updated_at'
  loop
    o := v_old -> k;
    n := v_new -> k;
    if k = 'body' then
      o := case when tg_op = 'INSERT' then null else jsonb_build_object('characters', char_length(v_old ->> 'body')) end;
      n := case when tg_op = 'DELETE' then null else jsonb_build_object('characters', char_length(v_new ->> 'body')) end;
    end if;
    if coalesce(v_old -> k, 'null'::jsonb) is distinct from coalesce(v_new -> k, 'null'::jsonb) then
      insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
      values ((v_row ->> 'tenant_id')::uuid, tg_table_name, (v_row ->> 'id')::uuid, k, o, n, auth.uid(), public.write_source());
    end if;
  end loop;
  return null;
end $$;

create trigger workspace_documents_a_meta before insert or update on public.workspace_documents
  for each row execute function public.set_write_meta();
create trigger workspace_documents_b_guard before insert or update on public.workspace_documents
  for each row execute function public.workspace_documents_guard();
create trigger workspace_documents_version after insert or update on public.workspace_documents
  for each row execute function public.workspace_documents_save_version();
create trigger workspace_documents_audit after insert or update or delete on public.workspace_documents
  for each row execute function public.workspace_documents_audit();

create trigger a_platform_readonly_guard before insert or update or delete on public.workspace_documents
  for each row execute function platform.readonly_guard();
create trigger a_platform_readonly_guard before insert or update or delete on public.workspace_document_versions
  for each row execute function platform.readonly_guard();

-- RLS (fast policy pattern, spike S7) and grants
alter table public.workspace_documents enable row level security;
alter table public.workspace_document_versions enable row level security;

create policy workspace_documents_select on public.workspace_documents for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy workspace_documents_insert on public.workspace_documents for insert to authenticated
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy workspace_documents_update on public.workspace_documents for update to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())))
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy workspace_documents_delete on public.workspace_documents for delete to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())));

create policy workspace_document_versions_select on public.workspace_document_versions for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));

revoke all on public.workspace_documents, public.workspace_document_versions from public, anon, authenticated;
grant select on public.workspace_documents, public.workspace_document_versions to authenticated;
grant insert (tenant_id, kind, title, body, status, ai_model) on public.workspace_documents to authenticated;
grant update (kind, title, body, status, ai_draft, ai_model) on public.workspace_documents to authenticated;
grant delete on public.workspace_documents to authenticated;

revoke all on function public.workspace_documents_guard(), public.workspace_documents_save_version(), public.workspace_documents_audit() from public, anon, authenticated;
