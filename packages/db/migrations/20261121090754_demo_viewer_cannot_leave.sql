-- 20261121090754: the demo viewer (issue #559, 20261121084429) must never be able to remove itself.
--
-- tenant_members_leave (0030) lets any member delete their OWN membership row to leave a workspace, with no
-- admin check (by design: that is how a normal person leaves). The shared, public demo account is signed into
-- by every visitor of the "See the demo" button, over the real anon key, so a visitor could call this directly
-- (bypassing the app's own leaveWorkspace guard) and delete the one row the whole demo depends on. Carve it out.

alter policy tenant_members_leave on public.tenant_members
  using (user_id = (select auth.uid()) and not is_demo_account);
