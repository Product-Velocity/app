-- #588 x #591: attention_snoozes (20261122153740) arrived after the paused-account guard (20261122153043) was attached to every tenant table.
-- Give it the same guard: writes to a paused account are refused unless the person is a platform admin. Safe to run twice.
do $$
declare r record;
begin
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'audit_log'
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = case when c.relname = 'tenants' then 'id' else 'tenant_id' end and not a.attisdropped)
       and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'b_platform_suspended_guard')
  loop
    execute format('create trigger b_platform_suspended_guard before insert or update or delete on public.%I
                    for each row execute function platform.suspended_guard()', r.relname);
  end loop;
end $$;
