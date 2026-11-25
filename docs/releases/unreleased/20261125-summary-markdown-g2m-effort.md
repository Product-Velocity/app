---
bump: minor
---
**Summary takes up to 4,000 characters and Markdown; new field G2M Effort.** The guidance for Summary said about 280 characters; it now says 4,000 (the limit the database always had), and Summary is written and previewed as Markdown in the panel, with the rendered text on hover in the grid, in alignment sessions and on the participant page. G2M Effort (None, XS, S, M, L, XL) sits next to G2M Date (est) and (actual): how much effort the go-to-market phase is expected to take, set from the start. It is in the Planning and Go-to-market views, in Claude's tools (`describe_fields`, `update_items`, `create_items`), in the Help field list and in copies of an initiative; it is not sent to GitHub or Jira. Migration `20261125130935_g2m_effort.sql`.
