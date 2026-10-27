-- 0037: Priority (field N45): P0 to P3, a different question from MoSCoW (Ashu, 2026-10-27).
-- No DROP statements: applied to Supabase through a tool that pauses on them.
alter table public.items add column priority text check (priority in ('P0', 'P1', 'P2', 'P3'));
grant insert (priority) on public.items to authenticated;
grant update (priority) on public.items to authenticated;
