-- 20261121084429: a fixed, shared "demo viewer" account for the public "See the demo" button (issue #559).
--
-- The demo button signs a visitor straight into a real tenant (Meridian Media) as a fixed, shared account:
-- role 'viewer' (already read-only everywhere by the existing role rules: items_insert/update/delete all
-- require my_editor_tenant_ids(), gate decisions require Approver, GitHub/Jira actions require creator/admin
-- and not a service account). This column marks that one row so the app can add the few extra lockdowns a
-- normal viewer does not need (export, the account page, the tenant switcher) and show a "read-only demo" banner.
--
-- A demo account is also a service account (is_service_account): it is not a real person, so it is excluded
-- from the directory, notifications and anywhere else that already filters service accounts out. The check
-- constraint keeps the two flags from drifting: a demo account can only ever be role 'viewer'.

alter table public.tenant_members
  add column is_demo_account boolean not null default false;

alter table public.tenant_members
  add constraint tenant_members_demo_viewer_role
  check (not is_demo_account or (role = 'viewer' and is_service_account));

comment on column public.tenant_members.is_demo_account is
  'The fixed, shared read-only account the public "See the demo" button signs visitors into (issue #559). Always role=viewer and is_service_account=true.';
