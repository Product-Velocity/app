-- 0031: invitation emails (issue #45). Provider: Resend (REST, no library), chosen by Ashu 2026-10-23.
-- invitations gets the delivery state of the email: not_sent (link only), sent, delivered, bounced, complained, failed; when it was sent,
--   how often (for the resend limit), a short error and the provider's message id (so a bounce can find its invitation).
--   These columns are written only by the server (service role); signed-in users have no grant on them.
-- invitation_reissue(): "Resend": an admin gives a pending invitation a NEW token and 7 more days. The old link stops working at once.
--   Accepted and revoked invitations cannot be reissued. Audited with the admin as actor.
-- No DROP statements: applied to Supabase through a tool that pauses on them.
alter table public.invitations
  add column email_status text not null default 'not_sent' check (email_status in ('not_sent', 'sent', 'delivered', 'bounced', 'complained', 'failed')),
  add column email_sent_at timestamptz,
  add column email_send_count integer not null default 0 check (email_send_count >= 0),
  add column email_error text check (char_length(email_error) <= 200),
  add column email_provider_id text check (char_length(email_provider_id) <= 100);
create index invitations_provider_id on public.invitations (email_provider_id) where email_provider_id is not null;

create function public.invitation_reissue(p_id uuid, p_token_hash text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  i public.invitations%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Bad token.' using errcode = '22023'; end if;
  select * into i from public.invitations where id = p_id for update;
  if not found or i.tenant_id <> all (array (select public.my_admin_tenant_ids())) then
    raise exception 'You cannot change this invitation.' using errcode = '42501';
  end if;
  if i.accepted_at is not null or i.revoked_at is not null then
    raise exception 'This invitation is already used or revoked.' using errcode = '22023';
  end if;
  perform set_config('app.via', coalesce(nullif(current_setting('app.via', true), ''), 'UI'), true);
  update public.invitations set token_hash = p_token_hash, expires_at = now() + interval '7 days',
         email_status = 'not_sent', email_error = null, email_provider_id = null
   where id = p_id;
end $$;
revoke all on function public.invitation_reissue(uuid, text) from public, anon;
grant execute on function public.invitation_reissue(uuid, text) to authenticated;
