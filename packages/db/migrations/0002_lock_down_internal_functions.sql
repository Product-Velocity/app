-- Hardening found by the Supabase security advisor after 0001 was applied.
-- 1) Trigger functions must not be callable through the API (/rest/v1/rpc).
--    0001 revoked from public and anon, but Supabase grants EXECUTE to
--    authenticated by default, so revoke that explicitly.
-- 2) audit_log_append_only had a mutable search_path.
-- Triggers do not need EXECUTE for the invoking role, so writes are unaffected.

alter function public.audit_log_append_only() set search_path = '';

revoke all on function public.audit_row(), public.set_write_meta(),
  public.guard_approver(), public.audit_log_append_only()
  from public, anon, authenticated;
