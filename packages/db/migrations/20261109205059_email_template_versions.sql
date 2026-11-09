-- Editable wording of product emails: versions, publish, restore (issue #370, phase 4).
-- Lives in the `platform` schema, which is not exposed through the API (no grants to anon or authenticated, RLS on with no policies).
-- Only platform admins can read or change it, through the security-definer functions below. Workspace admins, members and Claude have no path to it.
-- A draft never affects sending: the send path reads only the PUBLISHED version, through email_template_override() which only the server
-- (service role) may call. If that read fails, the app sends the code default (fallback), so a broken store never stops an email.
-- Every publish and restore is written to platform.config_log (the platform audit log), with the template key and the version numbers.
-- The text rules (no HTML, no typed links, only the macros a template allows) are checked by the app before saving AND again when the
-- published copy is loaded for sending; this table only holds the lengths. A platform admin calling these functions directly can still not
-- make the app send HTML or an unknown macro, because the load step discards a copy that breaks the rules.
-- No DROP statements and no row removals (versions are kept for compare and restore).
create table platform.email_template_versions (
  id bigint generated always as identity primary key,
  template_key text not null check (char_length(template_key) between 3 and 60),
  version integer not null check (version >= 1),
  status text not null check (status in ('draft', 'published', 'superseded')),
  subject text not null check (char_length(subject) between 1 and 200),
  preheader text not null check (char_length(preheader) <= 200),
  heading text not null check (char_length(heading) between 1 and 200),
  body text not null check (char_length(body) between 1 and 4000),
  button text check (button is null or char_length(button) between 1 and 60),
  note text not null check (char_length(note) <= 600),
  restored_from integer,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  published_by uuid references auth.users (id) on delete set null,
  published_at timestamptz,
  unique (template_key, version)
);
create unique index email_template_one_draft on platform.email_template_versions (template_key) where status = 'draft';
create unique index email_template_one_published on platform.email_template_versions (template_key) where status = 'published';
alter table platform.email_template_versions enable row level security;
revoke all on platform.email_template_versions from public, anon, authenticated;
grant all on platform.email_template_versions to service_role;

-- List the versions of one template, newest first, with who made and published them.
create function public.platform_email_versions(p_key text)
returns table (version integer, status text, subject text, preheader text, heading text, body text, button text, note text,
               restored_from integer, created_by_name text, created_at timestamptz, published_by_name text, published_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform platform.require_admin();
  return query
    select v.version, v.status, v.subject, v.preheader, v.heading, v.body, v.button, v.note, v.restored_from,
           coalesce(nullif(btrim(c.raw_user_meta_data ->> 'full_name'), ''), split_part(c.email, '@', 1)),
           v.created_at,
           coalesce(nullif(btrim(p.raw_user_meta_data ->> 'full_name'), ''), split_part(p.email, '@', 1)),
           v.published_at
      from platform.email_template_versions v
      left join auth.users c on c.id = v.created_by
      left join auth.users p on p.id = v.published_by
     where v.template_key = p_key
     order by v.version desc;
end $$;

-- Save the draft (one per template): updates the open draft or starts a new version. A draft does not affect sending.
create function public.platform_email_save_draft(p_key text, p_subject text, p_preheader text, p_heading text, p_body text, p_button text, p_note text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_version integer;
begin
  perform platform.require_admin();
  update platform.email_template_versions
     set subject = p_subject, preheader = p_preheader, heading = p_heading, body = p_body, button = p_button, note = p_note,
         created_by = auth.uid(), created_at = now()
   where template_key = p_key and status = 'draft'
   returning version into v_version;
  if v_version is null then
    insert into platform.email_template_versions (template_key, version, status, subject, preheader, heading, body, button, note, created_by)
    select p_key, coalesce(max(version), 0) + 1, 'draft', p_subject, p_preheader, p_heading, p_body, p_button, p_note, auth.uid()
      from platform.email_template_versions where template_key = p_key
    returning version into v_version;
  end if;
  return v_version;
end $$;

-- Throw the draft away (the published version and the history stay).
create function public.platform_email_discard_draft(p_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform platform.require_admin();
  update platform.email_template_versions set status = 'superseded' where template_key = p_key and status = 'draft';
end $$;

-- Publish the draft: it becomes the version that is sent; the one before is kept as superseded. Written to the platform audit log.
create function public.platform_email_publish(p_key text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_new integer; v_old integer;
begin
  perform platform.require_admin();
  select version into v_new from platform.email_template_versions where template_key = p_key and status = 'draft';
  if v_new is null then raise exception 'there is no draft to publish' using errcode = '22023'; end if;
  select version into v_old from platform.email_template_versions where template_key = p_key and status = 'published';
  update platform.email_template_versions set status = 'superseded' where template_key = p_key and status = 'published';
  update platform.email_template_versions set status = 'published', published_by = auth.uid(), published_at = now()
   where template_key = p_key and version = v_new;
  perform platform.log_config('email_template_publish', null, null, jsonb_build_object('template', p_key, 'version', v_old), jsonb_build_object('template', p_key, 'version', v_new));
  return v_new;
end $$;

-- Restore an older version: a NEW published version with the same wording (history is never rewritten). Written to the platform audit log.
create function public.platform_email_restore(p_key text, p_version integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_new integer; v_old integer; r platform.email_template_versions;
begin
  perform platform.require_admin();
  select * into r from platform.email_template_versions where template_key = p_key and version = p_version and status <> 'draft';
  if not found then raise exception 'that version does not exist' using errcode = '22023'; end if;
  select version into v_old from platform.email_template_versions where template_key = p_key and status = 'published';
  select coalesce(max(version), 0) + 1 into v_new from platform.email_template_versions where template_key = p_key;
  update platform.email_template_versions set status = 'superseded' where template_key = p_key and status = 'published';
  insert into platform.email_template_versions (template_key, version, status, subject, preheader, heading, body, button, note, restored_from, created_by, published_by, published_at)
  values (p_key, v_new, 'published', r.subject, r.preheader, r.heading, r.body, r.button, r.note, p_version, auth.uid(), auth.uid(), now());
  perform platform.log_config('email_template_restore', null, null,
    jsonb_build_object('template', p_key, 'version', v_old), jsonb_build_object('template', p_key, 'version', v_new, 'restored_from', p_version));
  return v_new;
end $$;

-- The published wording for the send path. Server only (service role): nobody signed in can call it.
create function public.email_template_override(p_key text)
returns table (subject text, preheader text, heading text, body text, button text, note text)
language sql stable security definer set search_path = '' as $$
  select v.subject, v.preheader, v.heading, v.body, v.button, v.note
    from platform.email_template_versions v where v.template_key = p_key and v.status = 'published'
$$;

revoke all on function public.platform_email_versions(text), public.platform_email_save_draft(text, text, text, text, text, text, text),
  public.platform_email_discard_draft(text), public.platform_email_publish(text), public.platform_email_restore(text, integer),
  public.email_template_override(text) from public, anon;
grant execute on function public.platform_email_versions(text), public.platform_email_save_draft(text, text, text, text, text, text, text),
  public.platform_email_discard_draft(text), public.platform_email_publish(text), public.platform_email_restore(text, integer) to authenticated;
revoke all on function public.email_template_override(text) from authenticated;
grant execute on function public.email_template_override(text) to service_role;
