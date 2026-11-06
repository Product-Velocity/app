-- 20261106090910_schema_migrations_status: lets the deploy-time check (tools/check-migrations.mjs, issue #344) read which migrations the database has recorded.
-- Forward-only. Never edit this file after it is applied; add a new migration instead.
-- New function only: public.schema_migrations_applied() returns name and checksum from pv_meta.schema_migrations (names and hashes of our own
-- migration files; no tenant data). Callable by service_role only (the build reads it over HTTPS with the service-role key); signed-in users and
-- anonymous visitors cannot call it. No table, no replaced function, no data touched.

create function public.schema_migrations_applied() returns table (name text, checksum text)
language sql stable security definer set search_path = '' as $$
  select m.name, m.checksum from pv_meta.schema_migrations m order by m.name
$$;
revoke all on function public.schema_migrations_applied() from public, anon, authenticated;
grant execute on function public.schema_migrations_applied() to service_role;
