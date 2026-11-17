-- Business Value Type gets new option names (Ashu, 2026-11-17). Forward-only: 0053 is applied, so replace the check constraint here.
--   Increase revenue -> Grow existing revenue
--   Decrease costs   -> Reduce costs
--   Defend revenue   -> Protect
--   Other            -> Enabler
-- New revenue is unchanged. The key (value_type) is unchanged. The tracker label pv:value/<type> follows the new name at the next Sync.
alter table public.items drop constraint if exists items_value_type_check;
update public.items set value_type = case value_type
    when 'Increase revenue' then 'Grow existing revenue'
    when 'Decrease costs' then 'Reduce costs'
    when 'Defend revenue' then 'Protect'
    when 'Other' then 'Enabler'
  end
  where value_type in ('Increase revenue', 'Decrease costs', 'Defend revenue', 'Other');
alter table public.items add constraint items_value_type_check
  check (value_type in ('New revenue', 'Grow existing revenue', 'Reduce costs', 'Protect', 'Enabler'));
