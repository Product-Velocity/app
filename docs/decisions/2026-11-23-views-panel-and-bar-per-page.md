---
date: 2026-11-23
by: Ashu ("yes, so 1 to 7 now"), built by Claude
request: 625
status: built, to confirm
---
**The views panel is clearer, and each page has its own bar.** One migration (`20261123160000_view_layouts_per_page.sql`).

- **My bar / Workspace bar** (admins only) is a switch at the top of the panel, replacing the footer link "Manage workspace bar". In workspace mode the panel is tinted and a banner says which page's bar changes for everyone.
- **The current view and its actions stay at the top** while the list scrolls, with a one-line summary of what changed ("2 filters, timeline settings changed since it was saved").
- **The list is the bar.** "In your bar" (with "3 of 6") on top: drag a row, or use the arrow keys on its grip (Alt+arrows on the row still work), and Remove. Below it, My views and Workspace views not in the bar, each with Add to bar. The old "In bar / Show in bar" toggle and the up and down buttons are gone.
- **A bar per page.** `view_layouts.page` ('grid', 'cards', 'gantt'). The migration copies every existing layout row to all three pages, so nobody's bar changed on the day it ran. Reordering, hiding and "Reset to workspace layout" now touch one page only. The 3-argument call of `replace_view_layout` still works and writes the Grid's (a browser on older code keeps working until it reloads).
- **Views remember the page they were saved on** (`saved_views.made_on`, only a label). A view made on another page shows a small tag ("Cards"); views made here are listed first. Views saved before this have no page and show no tag. Any view still opens on any page.
- **Look and placement.** Brand blue, 13px, AA. The button reads "Views" when every view is in the bar (not "0 more views"). The panel moves right when the button is near the left edge, and is a bottom sheet at 640px and narrower. The ⌘K / Ctrl+K hint sits at the foot.
- **Not built:** a view's page is not editable, and an admin's hide ("Hide for everyone") is still per built-in name per page.
- **Parity.** Not tracker related.
