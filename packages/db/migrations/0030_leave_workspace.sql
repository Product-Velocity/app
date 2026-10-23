-- 0030: a member can leave a workspace (account page, issue #44).
-- One more permissive policy: a person may remove their OWN membership row. Admins keep the existing policy for removing others.
-- The last-admin trigger (0005, error PV003) still stops the only admin from leaving, and the audit trigger records who left.
-- Nobody can remove another person's membership through this policy.
create policy tenant_members_leave on public.tenant_members
  for delete to authenticated using (user_id = (select auth.uid()));
