-- Business Value Type: "Protect" is called "Defend revenue" and "Other" is an option again (Ashu, 2026-11-17). Forward-only: 20261117223113 is already applied, so replace the check constraint again.
alter table public.items drop constraint if exists items_value_type_check;
update public.items set value_type = 'Defend revenue' where value_type = 'Protect';
alter table public.items add constraint items_value_type_check
  check (value_type in ('New revenue', 'Grow existing revenue', 'Reduce costs', 'Defend revenue', 'Enabler', 'Other'));
