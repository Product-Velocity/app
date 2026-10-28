-- 0053: Business Value Type gets five values (R-112). Forward-only: 0009 is already applied, so replace the check constraint here.
--   Incremental revenue                 -> Increase revenue
--   Defend existing revenue             -> Defend revenue
--   Save money / operational efficiency -> Decrease costs
-- New values with no old equivalent: New revenue, Other. The three field names changed in the dictionary only (keys are unchanged).
alter table public.items drop constraint if exists items_value_type_check;
update public.items set value_type = case value_type
    when 'Incremental revenue' then 'Increase revenue'
    when 'Defend existing revenue' then 'Defend revenue'
    when 'Save money / operational efficiency' then 'Decrease costs'
  end
  where value_type in ('Incremental revenue', 'Defend existing revenue', 'Save money / operational efficiency');
alter table public.items add constraint items_value_type_check
  check (value_type in ('New revenue', 'Increase revenue', 'Defend revenue', 'Decrease costs', 'Other'));
