---
date: 2026-11-23
by: Ashu
---
**On a phone the Decide bar has three buttons, Go, Hold and Stop, and the comment on a decision is optional everywhere (phone and web).** Supersedes two choices in `docs/29-MOBILE.md` section 4.5 (four buttons; required rationale) and the "writes a rationale" rule in `docs/28-DECISION-GATES.md`. On a phone, Go with conditions is "Add conditions" under Go; on web the four outcome cards stay. A comment, when written, is still kept as written and the decision stays append-only; a blank one is stored as null. Migration `20261123234656_optional_decision_rationale.sql` drops the `gate_reviews_rationale` check and the "needs a rationale" check in `decide_gate` (PV005); rights, first-decision-wins, the Claude refusal (PV004) and the audit are unchanged. Cost accepted: gate history will more often have no reasoning attached.
