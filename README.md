# Product Velocity — handover package

Put this folder's contents in the root of a new repository, then start Claude Code there.

```
CLAUDE.md                       rules and stack (read first)
docs/01-PRD.md                  product requirements, scope tags R1/R2/LATER
docs/02-ARCHITECTURE.md         stack, modules, key algorithms
docs/03-DATA-MODEL.md           entities and fields
docs/04-GITHUB-SYNC.md          GitHub App, mapping, breakdown routes
docs/05-AI-AND-MCP.md           Claude/MCP, guardrails, AI features
docs/06-BUILD-PLAN.md           phases with acceptance criteria
docs/07-PROTOTYPE-MAP.md        boards → features, known gaps
docs/08-SPIKES-AND-OPEN-QUESTIONS.md
docs/09-PRICING-AND-PITCH.md
docs/DECISIONS.md               decision log
.github/ISSUE_TEMPLATE/work-item.md
.claude/commands/work-issue.md  /work-issue <n>
prototype/project/              design prototype source (.dc.html + canvas.json)
```

Suggested start: ask Claude Code to (1) read CLAUDE.md and docs, (2) create the repo skeleton and CI, (3) run Phase 0 spikes and report, (4) open one GitHub issue per Phase 0/1 item using the template, then use `/work-issue <n>`.
Published prototype: https://claude.ai/artifact/WVtip16iTPYZdru67tsgUn
