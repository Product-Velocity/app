-- R-112 slice 1: documents on an initiative (docs/22-CLAUDE-PRD-FLOW.md).
-- A versioned Markdown document (the full PRD, requirements, research ...). It is never read for a GitHub payload.
-- Approval is a person with the Approver permission, never Claude (rule 3); the lifecycle flow that drives it comes later.

create table public.item_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  item_id uuid not null,
  kind text not null default 'prd'
    check (kind in ('prd', 'business_req', 'tech_req', 'acceptance', 'prototype', 'research', 'other')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text not null default '' check (char_length(body) <= 200000),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved')),
  version integer not null default 1 check (version >= 1),
  ai_draft boolean not null default false,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  constraint item_documents_approval check ((status = 'approved') = (approved_at is not null)),
  foreign key (tenant_id, item_id) references public.items (tenant_id, id) on delete cascade
);
create index item_documents_item_idx on public.item_documents (tenant_id, item_id);

-- Every saved version, so nothing a person or Claude wrote is lost. Written only by the trigger below.
create table public.item_document_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  document_id uuid not null references public.item_documents (id) on delete cascade,
  version integer not null,
  title text not null,
  body text not null,
  saved_at timestamptz not null default now(),
  saved_by uuid references auth.users (id) on delete set null,
  saved_via text not null default 'system',
  unique (document_id, version)
);
create index item_document_versions_doc_idx on public.item_document_versions (tenant_id, document_id, version);

-- ---------------------------------------------------------------------------
-- Rules: version bump, AI draft, approval
-- ---------------------------------------------------------------------------
create function public.item_documents_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_claude boolean := public.write_source() = 'Claude MCP';
  v_approver boolean;
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.status := case when new.status = 'approved' then 'draft' else new.status end;
    new.approved_by := null;
    new.approved_at := null;
    if v_claude then new.ai_draft := true; end if;
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id or new.item_id is distinct from old.item_id then
    raise exception 'A document cannot move to another initiative';
  end if;

  if v_claude then
    if new.ai_draft is distinct from old.ai_draft then
      raise exception 'Claude cannot accept or reject an AI draft; a person does' using errcode = 'PV004';
    end if;
    if new.status = 'approved' and old.status is distinct from 'approved' then
      raise exception 'Claude cannot approve a document; an Approver does' using errcode = 'PV004';
    end if;
  end if;

  if new.title is distinct from old.title or new.body is distinct from old.body then
    new.version := old.version + 1;
    -- a changed document is no longer the one that was approved
    if old.status = 'approved' and new.status = 'approved' then
      new.status := 'in_review';
    end if;
  else
    new.version := old.version;
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
    new.ai_draft := false; -- a person approved it
  elsif new.status is distinct from 'approved' then
    new.approved_by := null;
    new.approved_at := null;
  else
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
  end if;
  return new;
end $$;

create function public.item_documents_save_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.version is distinct from old.version then
    insert into public.item_document_versions (tenant_id, document_id, version, title, body, saved_by, saved_via)
    values (new.tenant_id, new.id, new.version, new.title, new.body, auth.uid(), public.write_source());
  end if;
  return null;
end $$;

-- Audit without the text: the versions table holds it, and the audit log should not carry document contents twice.
create function public.item_documents_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_row jsonb := case when tg_op = 'DELETE' then v_old else v_new end;
  k text;
  o jsonb;
  n jsonb;
begin
  if coalesce(current_setting('pv.audit_minimal', true), '') = 'on' and tg_op = 'DELETE' then
    return null; -- goes with a purged initiative; the initiative's own entry says what was removed
  end if;
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

create trigger item_documents_a_meta before insert or update on public.item_documents
  for each row execute function public.set_write_meta();
create trigger item_documents_b_guard before insert or update on public.item_documents
  for each row execute function public.item_documents_guard();
create trigger item_documents_version after insert or update on public.item_documents
  for each row execute function public.item_documents_save_version();
create trigger item_documents_audit after insert or update or delete on public.item_documents
  for each row execute function public.item_documents_audit();

-- A platform admin whose access to an account is read-only cannot write documents either (0051)
create trigger a_platform_readonly_guard before insert or update or delete on public.item_documents
  for each row execute function platform.readonly_guard();
create trigger a_platform_readonly_guard before insert or update or delete on public.item_document_versions
  for each row execute function platform.readonly_guard();

-- ---------------------------------------------------------------------------
-- RLS (fast policy pattern, spike S7) and grants
-- ---------------------------------------------------------------------------
alter table public.item_documents enable row level security;
alter table public.item_document_versions enable row level security;

create policy item_documents_select on public.item_documents for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
create policy item_documents_insert on public.item_documents for insert to authenticated
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy item_documents_update on public.item_documents for update to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())))
  with check (tenant_id = any (array (select public.my_editor_tenant_ids())));
create policy item_documents_delete on public.item_documents for delete to authenticated
  using (tenant_id = any (array (select public.my_editor_tenant_ids())));

create policy item_document_versions_select on public.item_document_versions for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));

revoke all on public.item_documents, public.item_document_versions from public, anon, authenticated;
grant select on public.item_documents, public.item_document_versions to authenticated;
grant insert (tenant_id, item_id, kind, title, body, status) on public.item_documents to authenticated;
grant update (kind, title, body, status, ai_draft) on public.item_documents to authenticated;
grant delete on public.item_documents to authenticated;

revoke all on function public.item_documents_guard(), public.item_documents_save_version(), public.item_documents_audit() from public, anon, authenticated;
