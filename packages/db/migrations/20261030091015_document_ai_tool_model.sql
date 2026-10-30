-- 20261030091015_document_ai_tool_model: which AI tool and model wrote a document, and a document-submission log for admins (request #230).
--
-- 1. public.assistant_of(client_name) + mcp_connections.assistant: which assistant (claude, chatgpt, gemini, other) a connected OAuth client is.
--    Mirrors detectAssistant() in packages/domain (a test keeps them in step). A label for people and analysis, never a permission.
--    public.current_assistant(): the assistant of the connection behind the caller's token (null when the write is not from an assistant).
-- 2. item_documents.ai_tool / ai_model: the AI tool and model that last wrote the document. The tool comes from the authenticated
--    connection (it cannot be forged); the model is what the assistant says about itself (advisory, free text, 80 characters), so it is
--    good for comparing models but not proof. item_document_versions keeps both for every version, so "written with Claude, revised by
--    ChatGPT" is in the history. A person's own edit never changes them.
-- 3. item_document_versions.saved_by_name / saved_by_email: who saved it, as they were at the time (like audit_log), for the log below.
-- 4. document_submissions(tenant) for the account's admins (and a platform admin inside the account) and platform_document_submissions(tenant)
--    for platform admins: one row per saved document version with person, project, initiative, document type, date, AI tool and model.
--    Titles and names only, never the text.
--
-- Functions replaced (create or replace): item_documents_guard and item_documents_save_version, both from 0055. Docs/23: no other open branch
-- changes them.

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

create function public.current_assistant() returns text
language sql stable security definer set search_path = '' as $$
  select case when nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id', '') is null then null
    else coalesce((select c.assistant from public.mcp_connections c
                    where c.user_id = auth.uid()
                      and c.client_id = nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id', '')
                      and c.revoked_at is null limit 1), 'other') end
$$;
revoke all on function public.current_assistant() from public, anon;
grant execute on function public.current_assistant() to authenticated;

-- ------------------------------------------------------------------------------------------------
alter table public.item_documents
  add column ai_tool text check (ai_tool is null or ai_tool in ('claude', 'chatgpt', 'gemini', 'other')),
  add column ai_model text check (ai_model is null or char_length(btrim(ai_model)) between 1 and 80);
alter table public.item_document_versions
  add column ai_tool text check (ai_tool is null or ai_tool in ('claude', 'chatgpt', 'gemini', 'other')),
  add column ai_model text check (ai_model is null or char_length(btrim(ai_model)) between 1 and 80),
  add column saved_by_name text,
  add column saved_by_email text;

-- what was written before this migration was written through Claude, and the people can be named from the account list
update public.item_document_versions v
   set ai_tool = case when v.saved_via = 'Claude MCP' then 'claude' end,
       saved_by_email = u.email::text,
       saved_by_name = coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1))
  from auth.users u where u.id = v.saved_by;
update public.item_documents d
   set ai_tool = 'claude'
 where d.created_via = 'Claude MCP' and d.ai_tool is null;

create or replace function public.item_documents_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_claude boolean := public.write_source() = 'Claude MCP';
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

  v_content := new.title is distinct from old.title or new.body is distinct from old.body;
  if v_content then
    new.version := old.version + 1;
    -- a changed document is no longer the one that was approved
    if old.status = 'approved' and new.status = 'approved' then
      new.status := 'in_review';
    end if;
  else
    new.version := old.version;
  end if;

  -- the AI tool and model of the latest AI author: an assistant that changes the text takes both over (the model is what it says, or empty);
  -- any other write, a person's included, leaves them as they were
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

create or replace function public.item_documents_save_version() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ai boolean := public.write_source() = 'Claude MCP';
  u record;
begin
  if tg_op = 'INSERT' or new.version is distinct from old.version then
    select au.email::text as email, coalesce(nullif(btrim(au.raw_user_meta_data ->> 'full_name'), ''), split_part(au.email, '@', 1)) as name
      into u from auth.users au where au.id = auth.uid();
    insert into public.item_document_versions (tenant_id, document_id, version, title, body, saved_by, saved_via, ai_tool, ai_model, saved_by_name, saved_by_email)
    values (new.tenant_id, new.id, new.version, new.title, new.body, auth.uid(), public.write_source(),
            case when v_ai then new.ai_tool end, case when v_ai then new.ai_model end, u.name, u.email);
  end if;
  return null;
end $$;

-- the model can be given when a document is written; the tool never can (the trigger sets it from the connection)
grant insert (ai_model) on public.item_documents to authenticated;
grant update (ai_model) on public.item_documents to authenticated;

-- ------------------------------------------------------------------------------------------------
-- Document submissions: one row per saved version. Titles and names only.
create function public.document_submissions(p_tenant uuid, p_limit integer default 50, p_before timestamptz default null)
returns table (
  version_id uuid, document_id uuid, item_id uuid, item_code text, initiative_name text, project_id uuid, project_name text,
  tenant_id uuid, tenant_name text, kind text, title text, version integer, saved_via text, ai_tool text, ai_model text,
  saved_at timestamptz, saved_by uuid, person_name text, person_email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_tenant is null or not (coalesce(public.is_tenant_admin(p_tenant), false) or platform.has_entry(auth.uid(), p_tenant)) then
    return; -- only the account's admins (and a platform admin who has entered the account) see the log
  end if;
  return query
    select v.id, v.document_id, d.item_id, i.item_code::text, i.initiative_name::text, p.id, p.name::text,
           v.tenant_id, t.name::text, d.kind, v.title, v.version, v.saved_via, v.ai_tool, v.ai_model,
           v.saved_at, v.saved_by, v.saved_by_name, v.saved_by_email
      from public.item_document_versions v
      join public.item_documents d on d.id = v.document_id
      join public.items i on i.id = d.item_id
      left join public.projects p on p.id = i.home_project_id
      join public.tenants t on t.id = v.tenant_id
     where v.tenant_id = p_tenant and (p_before is null or v.saved_at < p_before)
     order by v.saved_at desc, v.id
     limit greatest(1, least(coalesce(p_limit, 50), 500));
end $$;

create function public.platform_document_submissions(p_tenant uuid default null, p_limit integer default 50, p_before timestamptz default null)
returns table (
  version_id uuid, document_id uuid, item_id uuid, item_code text, initiative_name text, project_id uuid, project_name text,
  tenant_id uuid, tenant_name text, kind text, title text, version integer, saved_via text, ai_tool text, ai_model text,
  saved_at timestamptz, saved_by uuid, person_name text, person_email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform platform.require_admin();
  return query
    select v.id, v.document_id, d.item_id, i.item_code::text, i.initiative_name::text, p.id, p.name::text,
           v.tenant_id, t.name::text, d.kind, v.title, v.version, v.saved_via, v.ai_tool, v.ai_model,
           v.saved_at, v.saved_by, v.saved_by_name, v.saved_by_email
      from public.item_document_versions v
      join public.item_documents d on d.id = v.document_id
      join public.items i on i.id = d.item_id
      left join public.projects p on p.id = i.home_project_id
      join public.tenants t on t.id = v.tenant_id
     where (p_tenant is null or v.tenant_id = p_tenant) and (p_before is null or v.saved_at < p_before)
     order by v.saved_at desc, v.id
     limit greatest(1, least(coalesce(p_limit, 50), 500));
end $$;

revoke all on function public.document_submissions(uuid, integer, timestamptz), public.platform_document_submissions(uuid, integer, timestamptz) from public, anon;
grant execute on function public.document_submissions(uuid, integer, timestamptz), public.platform_document_submissions(uuid, integer, timestamptz) to authenticated;
