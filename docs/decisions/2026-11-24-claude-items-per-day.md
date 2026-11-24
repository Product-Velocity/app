---
date: 2026-11-24
by: Ashu
request: 667
---
**The daily Claude item limit is 1000 per workspace (was 200), and platform staff can set one workspace's own** (issue #667). A nullable `tenants.claude_items_per_day` overrides the default; only a platform admin can set it (`platform_set_claude_items_limit`, written to the configuration log and the account's audit log, 1 to 100000), from the account drawer in the platform console. Workspace admins see their limit in Settings, Connect an AI assistant, but cannot change it: the limit is a cost and abuse guardrail, so the customer does not hold the dial (rule 10). The 100 MB, 10,000 calls and 2,000 calls per connection limits are unchanged and global. Migration `20261124200701_claude_items_per_day_limit.sql`.
