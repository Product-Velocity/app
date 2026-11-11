---
date: 2026-11-11
by: Claude (for Ashu to review)
request: column picker sort and locks (no issue number yet)
---
**Sorting and locking are set per column in the Columns picker, and the Sort button leaves the action bar.** Ashu asked for this in two messages; the points below are what I decided where the request left room. Any can be reversed.

1. **Several sorts, ordered by the list.** A view stores an ordered list of sorts (`sort` is a JSON list; the first is the main one). The order is the order of the selected columns, so moving a column up makes it sort earlier. The picker shows 1, 2, ... next to sorted columns. A removed column loses its sort. Direction words in the picker are Asc and Desc; the footer still uses A-Z, Low to high and so on. Rows tied on every sort keep the Stack Rank order, and empty values go last, as before.
2. **Older views.** A saved single sort object is read as a one-item list. The `saved_views.sort` check now allows an object or a list; nothing is rewritten.
3. **Locks: up to four, any column (Ashu's choice).** Rank, ID and name are no longer forced; they start locked in every default view and can be unlocked. At most four columns are locked in total; a fifth says "You can lock up to 4 columns. Unlock one first." Locked columns always sit first in the list, in the order the grid shows them; the three core columns remain in the view and cannot be removed.
4. **Older locks.** Before, a view listed only the extra lock besides rank, ID and name. A new column `pins_explicit` (default false) says which meaning a row has: false reads as rank, ID, name and the listed one; true means the list is the whole set (an empty list means none). Nothing is rewritten, so the audit trigger does not fire for old rows.
5. **Palette.** "Sort: global Stack Rank" stays and clears all sorts. Sorting by header click is still later.
