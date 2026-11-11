---
bump: minor
---
**Sorting and locking now live in the Columns picker.** Each selected column has its own sort (No sort, Asc or Desc); sorted columns higher in the list are sorted first, so a view can sort by several columns, and the picker numbers them. The separate Sort button is gone from the action bar. You can lock up to four columns of your choice (any column, including rank, ID and name, which start locked): locked columns sit at the top of the list and stay on the left when the grid scrolls right. Views save the ordered sorts and the locked columns (Update and Save as new view); views saved earlier open as before. Migration `20261111124842_sort_list_in_saved_views`.
