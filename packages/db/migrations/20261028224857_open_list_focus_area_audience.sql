-- issue #246: Focus Area and Audience become open lists, like Initiative Group (Ashu, 2026-10-28).
-- People type any value and it is accepted; the app suggests the values already in use and keeps one spelling. The fixed-value checks of 0009
-- are replaced by a length check. No data is touched: every value stored so far stays valid. No function is replaced.

alter table public.items drop constraint if exists items_focus_area_check;
alter table public.items add constraint items_focus_area_check check (char_length(focus_area) <= 120);

alter table public.items drop constraint if exists items_audience_check;
alter table public.items add constraint items_audience_check check (char_length(audience) <= 120);
