-- 0033: alignment participants, invitations and the confirm step (issue #124). Privacy model: docs/19-ALIGNMENT-PRIVACY.md.
-- alignment_participants: who was invited to a session (email, optional name, group), the one-time link (only a hash is kept; the
--   previous hash is kept so a replaced link can still offer a new one), the browser the link was first opened in (hash of a secret in a
--   cookie), consent (time and wording version), delivery state of the email, unsubscribe from reminders and removal.
--   NOBODY reads this table through the API: admins use alignment_participants_list(), the server (service role) reads it for links.
--   Its audit entries are written by its own trigger and never contain the email, the name or a token.
-- alignment_ballots: one row per participant and session (voted or not). The answers (votes) arrive with #125. Not readable through the API.
-- alignment_mailings: one invitation or reminder text, the people it goes to (fixed when the draft is made), and its state:
--   draft, confirmed, sending, done, cancelled. A person must confirm; Claude and service accounts cannot (PV004). The server can read the
--   addresses of a mailing only once it is confirmed (alignment_mailing_recipients), so nothing can be sent before the confirm step.
-- Removing a participant clears the personal data and keeps the row, so counts and ballots stay (anonymous), as the privacy note says.
-- No DROP statements and no row removals: applied to Supabase through a tool that pauses on them.
create table public.alignment_participants (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  session_id uuid not null,
  email text check (char_length(email) <= 254),
  email_hash text check (email_hash ~ '^[0-9a-f]{64}$'),
  name text check (char_length(name) <= 120),
  group_id text not null,
  token_hash text check (token_hash ~ '^[0-9a-f]{64}$'),
  prev_token_hash text check (prev_token_hash ~ '^[0-9a-f]{64}$'),
  token_issued_at timestamptz,
  browser_hash text check (browser_hash ~ '^[0-9a-f]{64}$'),
  bound_at timestamptz,
  consent_at timestamptz,
  consent_version text,
  invited_at timestamptz,
  email_status text not null default 'not_sent' check (email_status in ('not_sent', 'sent', 'delivered', 'bounced', 'complained', 'failed')),
  email_sent_at timestamptz,
  email_send_count integer not null default 0 check (email_send_count >= 0),
  email_error text check (char_length(email_error) <= 200),
  email_provider_id text check (char_length(email_provider_id) <= 100),
  last_mailing_id uuid,
  unsubscribed_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  foreign key (tenant_id, session_id) references public.alignment_sessions (tenant_id, id) on delete cascade,
  unique (tenant_id, id),
  unique (session_id, email_hash)
);
create index alignment_participants_tenant on public.alignment_participants (tenant_id, session_id);
create unique index alignment_participants_token on public.alignment_participants (token_hash) where token_hash is not null;
create index alignment_participants_prev_token on public.alignment_participants (prev_token_hash) where prev_token_hash is not null;
create index alignment_participants_provider on public.alignment_participants (email_provider_id) where email_provider_id is not null;
create trigger alignment_participants_meta before insert or update on public.alignment_participants
  for each row execute function public.set_write_meta();

create function public.alignment_participants_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := to_jsonb(new);
  k text;
begin
  foreach k in array array['group_id', 'invited_at', 'email_status', 'consent_at', 'bound_at', 'unsubscribed_at', 'removed_at', 'email_send_count'] loop
    if coalesce(v_old -> k, 'null'::jsonb) is distinct from coalesce(v_new -> k, 'null'::jsonb) then
      insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
      values (new.tenant_id, 'alignment_participants', new.id, k, v_old -> k, v_new -> k, auth.uid(), public.write_source());
    end if;
  end loop;
  return null;
end $$;
create trigger alignment_participants_audit after insert or update on public.alignment_participants
  for each row execute function public.alignment_participants_audit();
alter table public.alignment_participants enable row level security;
revoke all on public.alignment_participants from public, anon, authenticated;
grant all on public.alignment_participants to service_role;

create table public.alignment_ballots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  session_id uuid not null,
  participant_id uuid,
  group_id text not null,
  state text not null default 'in_progress' check (state in ('in_progress', 'submitted')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  foreign key (tenant_id, session_id) references public.alignment_sessions (tenant_id, id) on delete cascade,
  foreign key (tenant_id, participant_id) references public.alignment_participants (tenant_id, id) on delete set null (participant_id),
  unique (tenant_id, id)
);
create unique index alignment_ballots_participant on public.alignment_ballots (session_id, participant_id) where participant_id is not null;
create index alignment_ballots_tenant on public.alignment_ballots (tenant_id, session_id);
create trigger alignment_ballots_meta before insert or update on public.alignment_ballots
  for each row execute function public.set_write_meta();
-- the ballot's audit entries carry the state only: the generic audit would also record which participant owns it, and who voted what
-- is opened only through the logged "Show names" action (docs/19 section 4)
create function public.alignment_ballots_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := to_jsonb(new);
  k text;
begin
  foreach k in array array['state', 'submitted_at'] loop
    if coalesce(v_old -> k, 'null'::jsonb) is distinct from coalesce(v_new -> k, 'null'::jsonb) then
      insert into public.audit_log (tenant_id, entity, entity_id, field, old, new, actor_id, via)
      values (new.tenant_id, 'alignment_ballots', new.id, k, v_old -> k, v_new -> k, auth.uid(), public.write_source());
    end if;
  end loop;
  return null;
end $$;
create trigger alignment_ballots_audit after insert or update on public.alignment_ballots
  for each row execute function public.alignment_ballots_audit();
alter table public.alignment_ballots enable row level security;
revoke all on public.alignment_ballots from public, anon, authenticated;
grant all on public.alignment_ballots to service_role;

create table public.alignment_mailings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  session_id uuid not null,
  kind text not null check (kind in ('invitation', 'reminder')),
  subject text not null check (char_length(btrim(subject)) between 1 and 150),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  recipient_ids uuid[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'sending', 'done', 'cancelled')),
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'system'
    check (created_via in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system')),
  foreign key (tenant_id, session_id) references public.alignment_sessions (tenant_id, id) on delete cascade,
  unique (tenant_id, id)
);
create index alignment_mailings_tenant on public.alignment_mailings (tenant_id, session_id, created_at desc);
create trigger alignment_mailings_meta before insert or update on public.alignment_mailings
  for each row execute function public.set_write_meta();
create trigger alignment_mailings_audit after insert or update on public.alignment_mailings
  for each row execute function public.audit_row();
alter table public.alignment_mailings enable row level security;
create policy alignment_mailings_select on public.alignment_mailings for select to authenticated
  using (tenant_id = any (array (select public.my_tenant_ids())));
revoke all on public.alignment_mailings from public, anon, authenticated;
grant select on public.alignment_mailings to authenticated;
grant all on public.alignment_mailings to service_role;

-- Add people to a session: [{email, name, group}]. Duplicates (same address, any capitals) are merged into the person already there.
create function public.alignment_participants_add(p_session uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.alignment_sessions%rowtype;
  r jsonb;
  v_email text;
  v_group text;
  v_added integer := 0;
  v_merged integer := 0;
  v_invalid integer := 0;
  v_new boolean;
begin
  select * into s from public.alignment_sessions where id = p_session;
  if not found or s.tenant_id <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'You cannot change this session.' using errcode = '42501';
  end if;
  if s.status not in ('draft', 'open') then raise exception 'People cannot be added to a closed session.' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Add between 1 and 500 people at a time.' using errcode = '22023'; end if;
  if (select count(*) from public.alignment_participants x where x.session_id = p_session) + jsonb_array_length(p_rows) > 2000 then
    raise exception 'A session can have at most 2000 participants.' using errcode = '22023';
  end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  for r in select * from jsonb_array_elements(p_rows) loop
    v_email := lower(btrim(coalesce(r ->> 'email', '')));
    v_group := coalesce(r ->> 'group', '');
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(v_email) > 254
       or not exists (select 1 from jsonb_array_elements(s.groups) g where g ->> 'id' = v_group) then
      v_invalid := v_invalid + 1;
      continue;
    end if;
    insert into public.alignment_participants as p (tenant_id, session_id, email, email_hash, name, group_id)
    values (s.tenant_id, p_session, v_email, encode(sha256(convert_to(v_email, 'UTF8')), 'hex'), nullif(left(btrim(coalesce(r ->> 'name', '')), 120), ''), v_group)
    on conflict (session_id, email_hash) do update set name = coalesce(p.name, excluded.name)
    returning (xmax = 0) into v_new;
    if v_new then v_added := v_added + 1; else v_merged := v_merged + 1; end if;
  end loop;
  return jsonb_build_object('added', v_added, 'merged', v_merged, 'invalid', v_invalid);
end $$;
revoke all on function public.alignment_participants_add(uuid, jsonb) from public, anon;
grant execute on function public.alignment_participants_add(uuid, jsonb) to authenticated;

-- The list admins see: address, name, group, delivery, consent, unsubscribed, voted. Only admins; never the answers.
create function public.alignment_participants_list(p_session uuid)
returns table (id uuid, email text, name text, group_id text, invited_at timestamptz, email_status text, email_sent_at timestamptz, email_error text,
               consent_at timestamptz, unsubscribed_at timestamptz, removed_at timestamptz, voted boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
begin
  select s.tenant_id into v_tenant from public.alignment_sessions s where s.id = p_session;
  if v_tenant is null or v_tenant <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'You cannot see these participants.' using errcode = '42501';
  end if;
  return query
    select p.id, p.email, p.name, p.group_id, p.invited_at, p.email_status, p.email_sent_at, p.email_error, p.consent_at, p.unsubscribed_at, p.removed_at,
           exists (select 1 from public.alignment_ballots b where b.participant_id = p.id and b.state = 'submitted')
      from public.alignment_participants p
     where p.session_id = p_session
     order by p.seq;
end $$;
revoke all on function public.alignment_participants_list(uuid) from public, anon;
grant execute on function public.alignment_participants_list(uuid) to authenticated;

-- Clears the personal data of one participant (deletion on request). The row stays so counts and any ballot stay, anonymous.
create function public.alignment_participant_remove(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.alignment_participants%rowtype;
begin
  select * into p from public.alignment_participants where id = p_id for update;
  if not found or p.tenant_id <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'You cannot change this participant.' using errcode = '42501';
  end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  update public.alignment_participants set email = null, email_hash = null, name = null, token_hash = null, prev_token_hash = null, browser_hash = null,
         email_provider_id = null, email_error = null, removed_at = coalesce(removed_at, now())
   where id = p_id;
end $$;
revoke all on function public.alignment_participant_remove(uuid) from public, anon;
grant execute on function public.alignment_participant_remove(uuid) to authenticated;

-- Who a mailing would go to right now. Invitations: not yet invited. Reminders: invited, not voted. Never removed, unsubscribed (reminders),
-- bounced or complained addresses.
create function pv_internal.mailing_recipients(p_session uuid, p_kind text)
returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(p.id order by p.seq), '{}')
    from public.alignment_participants p
   where p.session_id = p_session and p.removed_at is null and p.email is not null
     and p.email_status not in ('bounced', 'complained')
     and ((p_kind = 'invitation' and p.invited_at is null)
       or (p_kind = 'reminder' and p.invited_at is not null and p.unsubscribed_at is null
           and not exists (select 1 from public.alignment_ballots b where b.participant_id = p.id and b.state = 'submitted')))
$$;
revoke all on function pv_internal.mailing_recipients(uuid, text) from public, anon, authenticated;

create function public.alignment_mailing_draft(p_session uuid, p_kind text, p_subject text, p_body text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.alignment_sessions%rowtype;
  v_ids uuid[];
  v_id uuid;
begin
  select * into s from public.alignment_sessions where id = p_session;
  if not found or s.tenant_id <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'You cannot change this session.' using errcode = '42501';
  end if;
  if p_kind not in ('invitation', 'reminder') then raise exception 'Unknown kind.' using errcode = '22023'; end if;
  if s.status not in ('draft', 'open') then raise exception 'This session is closed.' using errcode = '22023'; end if;
  v_ids := pv_internal.mailing_recipients(p_session, p_kind);
  if coalesce(array_length(v_ids, 1), 0) = 0 then raise exception 'There is nobody to send this to.' using errcode = '22023'; end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  insert into public.alignment_mailings (tenant_id, session_id, kind, subject, body, recipient_ids)
  values (s.tenant_id, p_session, p_kind, btrim(p_subject), btrim(p_body), v_ids) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.alignment_mailing_draft(uuid, text, text, text) from public, anon;
grant execute on function public.alignment_mailing_draft(uuid, text, text, text) to authenticated;

create function public.alignment_mailing_edit(p_id uuid, p_subject text, p_body text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.alignment_mailings%rowtype;
  v_ids uuid[];
begin
  select * into m from public.alignment_mailings where id = p_id for update;
  if not found or m.tenant_id <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'You cannot change this mailing.' using errcode = '42501';
  end if;
  if m.status <> 'draft' then raise exception 'Only a draft can be changed.' using errcode = '22023'; end if;
  v_ids := pv_internal.mailing_recipients(m.session_id, m.kind);
  if coalesce(array_length(v_ids, 1), 0) = 0 then raise exception 'There is nobody to send this to.' using errcode = '22023'; end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  update public.alignment_mailings set subject = btrim(p_subject), body = btrim(p_body), recipient_ids = v_ids where id = p_id;
end $$;
revoke all on function public.alignment_mailing_edit(uuid, text, text) from public, anon;
grant execute on function public.alignment_mailing_edit(uuid, text, text) to authenticated;

create function public.alignment_mailing_cancel(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.alignment_mailings%rowtype;
begin
  select * into m from public.alignment_mailings where id = p_id for update;
  if not found or m.tenant_id <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'You cannot change this mailing.' using errcode = '42501';
  end if;
  if m.status not in ('draft', 'confirmed') then raise exception 'This mailing has already started.' using errcode = '22023'; end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  update public.alignment_mailings set status = 'cancelled' where id = p_id;
end $$;
revoke all on function public.alignment_mailing_cancel(uuid) from public, anon;
grant execute on function public.alignment_mailing_cancel(uuid) to authenticated;

-- The confirm step. A person only: Claude and service accounts are refused. p_expected is the number of people the person saw.
create function public.alignment_mailing_confirm(p_id uuid, p_expected integer)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.alignment_mailings%rowtype;
  s public.alignment_sessions%rowtype;
  v_ids uuid[];
begin
  perform pv_internal.refuse_claude();
  select * into m from public.alignment_mailings where id = p_id for update;
  if not found or m.tenant_id <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'You cannot change this mailing.' using errcode = '42501';
  end if;
  if m.status <> 'draft' then raise exception 'This mailing was already confirmed or cancelled.' using errcode = '22023'; end if;
  select * into s from public.alignment_sessions where id = m.session_id;
  if s.status <> 'open' then raise exception 'Open the session before sending.' using errcode = '22023'; end if;
  v_ids := pv_internal.mailing_recipients(m.session_id, m.kind);
  if v_ids is distinct from m.recipient_ids or coalesce(array_length(v_ids, 1), 0) <> p_expected then
    raise exception 'The list of people changed. Review the mailing again.' using errcode = '22023';
  end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  update public.alignment_mailings set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now() where id = p_id;
end $$;
revoke all on function public.alignment_mailing_confirm(uuid, integer) from public, anon;
grant execute on function public.alignment_mailing_confirm(uuid, integer) to authenticated;

-- Server only. Addresses of a confirmed mailing whose turn has not come yet. Refuses anything not confirmed: this is what makes
-- "nothing is sent before a person confirmed" true even if the application code were wrong.
create function public.alignment_mailing_recipients(p_mailing uuid)
returns table (id uuid, email text, name text, group_id text)
language plpgsql security definer set search_path = '' as $$
declare
  m public.alignment_mailings%rowtype;
  s public.alignment_sessions%rowtype;
begin
  select * into m from public.alignment_mailings where alignment_mailings.id = p_mailing for update;
  if not found or m.status not in ('confirmed', 'sending') or m.confirmed_at is null then
    raise exception 'This mailing has not been confirmed by a person.' using errcode = 'PV010';
  end if;
  select * into s from public.alignment_sessions where alignment_sessions.id = m.session_id;
  if s.status <> 'open' then raise exception 'The session is not open.' using errcode = '22023'; end if;
  perform set_config('app.via', 'system', true);
  if m.status = 'confirmed' then update public.alignment_mailings set status = 'sending' where alignment_mailings.id = p_mailing; end if;
  return query
    select p.id, p.email, p.name, p.group_id
      from public.alignment_participants p
     where p.id = any (m.recipient_ids) and p.removed_at is null and p.email is not null
       and p.last_mailing_id is distinct from p_mailing
       and (m.kind = 'invitation' or (p.unsubscribed_at is null and not exists (select 1 from public.alignment_ballots b where b.participant_id = p.id and b.state = 'submitted')))
     order by p.seq;
end $$;
revoke all on function public.alignment_mailing_recipients(uuid) from public, anon, authenticated;
grant execute on function public.alignment_mailing_recipients(uuid) to service_role;

-- Server only. A new link for one recipient of a confirmed mailing (the old link keeps working as "ask for a new one").
create function public.alignment_mailing_issue(p_mailing uuid, p_participant uuid, p_token_hash text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.alignment_mailings%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Bad token.' using errcode = '22023'; end if;
  select * into m from public.alignment_mailings where id = p_mailing;
  if not found or m.status not in ('confirmed', 'sending') or not (p_participant = any (m.recipient_ids)) then
    raise exception 'This mailing has not been confirmed by a person.' using errcode = 'PV010';
  end if;
  perform set_config('app.via', 'system', true);
  update public.alignment_participants set prev_token_hash = token_hash, token_hash = p_token_hash, token_issued_at = now(), browser_hash = null, bound_at = null
   where id = p_participant and removed_at is null;
end $$;
revoke all on function public.alignment_mailing_issue(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.alignment_mailing_issue(uuid, uuid, text) to service_role;

create function public.alignment_mailing_result(p_mailing uuid, p_participant uuid, p_ok boolean, p_provider text, p_error text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.alignment_mailings%rowtype;
  v_left integer;
begin
  select * into m from public.alignment_mailings where id = p_mailing for update;
  if not found or m.status not in ('confirmed', 'sending') or not (p_participant = any (m.recipient_ids)) then
    raise exception 'This mailing has not been confirmed by a person.' using errcode = 'PV010';
  end if;
  perform set_config('app.via', 'system', true);
  if p_ok then
    update public.alignment_participants set last_mailing_id = p_mailing, email_status = 'sent', email_sent_at = now(), email_send_count = email_send_count + 1,
           invited_at = coalesce(invited_at, now()), email_provider_id = left(p_provider, 100), email_error = null
     where id = p_participant;
    update public.alignment_mailings set sent_count = sent_count + 1 where id = p_mailing;
  else
    update public.alignment_participants set last_mailing_id = p_mailing, email_status = 'failed', email_error = left(p_error, 200) where id = p_participant;
    update public.alignment_mailings set failed_count = failed_count + 1 where id = p_mailing;
  end if;
  select count(*) into v_left from public.alignment_participants p where p.id = any (m.recipient_ids) and p.removed_at is null and p.last_mailing_id is distinct from p_mailing;
  if v_left = 0 then update public.alignment_mailings set status = 'done' where id = p_mailing; end if;
end $$;
revoke all on function public.alignment_mailing_result(uuid, uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.alignment_mailing_result(uuid, uuid, boolean, text, text) to service_role;

-- Server only. A participant asks for a new link (expired, replaced or opened in another browser). Only someone who was invited, at most
-- 6 emails in total per person and one a minute. Returns what is needed to write the email, or nothing.
create function public.alignment_link_resend(p_old_hash text, p_new_hash text)
returns table (id uuid, email text, name text, session_name text, closes_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  p public.alignment_participants%rowtype;
  s public.alignment_sessions%rowtype;
begin
  if p_new_hash is null or p_new_hash !~ '^[0-9a-f]{64}$' then raise exception 'Bad token.' using errcode = '22023'; end if;
  select * into p from public.alignment_participants where token_hash = p_old_hash or prev_token_hash = p_old_hash for update;
  if not found or p.removed_at is not null or p.email is null or p.invited_at is null then return; end if;
  select * into s from public.alignment_sessions where alignment_sessions.id = p.session_id;
  if s.status <> 'open' then return; end if;
  if p.email_send_count >= 6 or (p.email_sent_at is not null and p.email_sent_at > now() - interval '1 minute') then return; end if;
  perform set_config('app.via', 'system', true);
  update public.alignment_participants set prev_token_hash = token_hash, token_hash = p_new_hash, token_issued_at = now(), browser_hash = null, bound_at = null,
         email_send_count = email_send_count + 1, email_sent_at = now()
   where alignment_participants.id = p.id;
  return query select p.id, p.email, p.name, s.name, s.closes_at;
end $$;
revoke all on function public.alignment_link_resend(text, text) from public, anon, authenticated;
grant execute on function public.alignment_link_resend(text, text) to service_role;

-- Daily: personal data of participants is cleared when the retention time after closing has passed (default 12 months).
create function public.alignment_purge_personal_data()
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  perform set_config('app.via', 'system', true);
  update public.alignment_participants p set email = null, email_hash = null, name = null, token_hash = null, prev_token_hash = null, browser_hash = null,
         email_provider_id = null, email_error = null, removed_at = now()
    from public.alignment_sessions s
   where s.id = p.session_id and p.removed_at is null and s.closed_at is not null
     and s.closed_at + make_interval(months => s.retention_months) <= now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.alignment_purge_personal_data() from public, anon, authenticated;
grant execute on function public.alignment_purge_personal_data() to service_role;
