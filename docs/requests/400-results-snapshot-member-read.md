---
issue: 400
status: open
logged: 2026-11-10
title: Members can read results_snapshot through the API even when show_results is off
---
Ashu (2026-11-10): open an issue for the gap found while building #393 and #394. A throwaway test confirmed that a viewer can select `results_snapshot` from `alignment_sessions` for a closed session with `show_results` off, which contradicts `docs/19` sections 2 and 6. The snapshot holds aggregates only (no names, emails or ballots). Fix by a column-level privilege plus one function that applies the rule; see the issue.
