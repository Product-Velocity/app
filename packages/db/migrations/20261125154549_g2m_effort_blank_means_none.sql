-- G2M Effort: blank is "none" (Ashu, 2026-11-25, issue 676 follow-up). The picker already offers a blank "None" choice, so a stored word
-- "None" showed the option twice and wrote the word into the column. Rows that hold 'None' become blank; the list is XS to XL only.
-- Replaces nothing else (the copy function copies the column as it is).
alter table public.items drop constraint if exists items_g2m_effort_check;
update public.items set g2m_effort = null where g2m_effort = 'None';
alter table public.items add constraint items_g2m_effort_check check (g2m_effort in ('XS', 'S', 'M', 'L', 'XL'));
