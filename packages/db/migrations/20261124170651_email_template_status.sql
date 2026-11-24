-- email_template_status: an Active or Paused switch per product email, kept in the platform Emails console instead of a deployment setting
-- (issue #634, Ashu 2026-11-24). Replaces the FOUNDER_EMAILS environment variable.
-- Forward-only. Never edit this file after it is applied; add a new migration instead.
-- Lives in the `platform` schema (not exposed through the API; RLS on with no policies), like the email wording. Only platform admins can read or
-- change it, through the security-definer functions below; the send path reads it through email_template_status(), which only the server (service
-- role) may call. A row exists only once someone has switched an email: with no row the app uses the template's own default (the personal notes
-- start Paused, every other email Active). Which emails may be paused at all (never a sign-in, confirmation or reset email) is decided in the app.
-- Every change is written to platform.config_log (the platform audit log). New functions only; none is replaced. No DROP statements.

create table platform.email_template_status (
  template_key text primary key check (char_length(template_key) between 3 and 60),
  status text not null check (status in ('active', 'paused')),
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now()
);
alter table platform.email_template_status enable row level security;
revoke all on platform.email_template_status from public, anon, authenticated;
grant all on platform.email_template_status to service_role;

-- Every switched email, for the console. Platform admins only.
create function public.platform_email_statuses()
returns table (template_key text, status text, changed_at timestamptz, changed_by_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform platform.require_admin();
  return query
    select s.template_key, s.status, s.changed_at,
           coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1))
      from platform.email_template_status s
      left join auth.users u on u.id = s.changed_by
     order by s.template_key;
end $$;

-- Switch one email to active or paused. Platform admins only; written to the platform audit log with the old and new state.
create function public.platform_email_set_status(p_key text, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  perform platform.require_admin();
  if p_status not in ('active', 'paused') then raise exception 'status must be active or paused' using errcode = '22023'; end if;
  if p_key is null or char_length(p_key) not between 3 and 60 then raise exception 'unknown email' using errcode = '22023'; end if;
  select status into v_old from platform.email_template_status where template_key = p_key;
  insert into platform.email_template_status (template_key, status, changed_by, changed_at)
  values (p_key, p_status, auth.uid(), now())
  on conflict (template_key) do update set status = excluded.status, changed_by = excluded.changed_by, changed_at = excluded.changed_at;
  perform platform.log_config('email_template_status', null, null,
    jsonb_build_object('template', p_key, 'status', v_old), jsonb_build_object('template', p_key, 'status', p_status));
end $$;

-- The state for the send path: 'active', 'paused', or no row (the app then uses the template's default). Server only (service role).
create function public.email_template_status(p_key text) returns text
language sql stable security definer set search_path = '' as $$
  select s.status from platform.email_template_status s where s.template_key = p_key
$$;

revoke all on function public.platform_email_statuses(), public.platform_email_set_status(text, text), public.email_template_status(text) from public, anon;
grant execute on function public.platform_email_statuses(), public.platform_email_set_status(text, text) to authenticated;
revoke execute on function public.email_template_status(text) from authenticated;
grant execute on function public.email_template_status(text) to service_role;
