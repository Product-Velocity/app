---
bump: minor
---
**The alignment result on each initiative (issue #393).** The Alignment tab of the item panel now shows what the vote said about the initiative: its place (ties written as "=2"), score out of 100, how many people voted, whether the groups agreed or which groups disagreed, and earlier sessions as history. Crowd Rank, Crowd Score, Consensus and Votes are now live read-only columns in the grid, and Crowd Rank joins the Prioritisation view. Admins see every closed session; other members only those that let participants see results. No names, and groups with fewer than 5 voters are never shown. New migration `20261110004333_item_alignment_results.sql` (a new function; nothing dropped).
