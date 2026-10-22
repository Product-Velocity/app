-- Rename the roadmap category value "Close the gap with competitors" to "Close capability gaps".
-- Forward-only: 0009 is already applied, so replace the check constraint here.
alter table public.items drop constraint if exists items_roadmap_category_check;
update public.items set roadmap_category = 'Close capability gaps' where roadmap_category = 'Close the gap with competitors';
alter table public.items add constraint items_roadmap_category_check
  check (roadmap_category in ('New big bets', 'Grow customer revenues', 'Protect customer revenues', 'Operational efficiency', 'Close capability gaps'));
