---
bump: minor
---
**Gate notifications (issue #341).** A Notifications button with an unread count in the top bar. When a gate is requested, the people who can decide it are told (or only the people the requester asked, in the new optional "Ask these people" list of the request dialog); when it is decided or withdrawn, the requester is told. Opening a notice marks it read and leads to Decisions or the initiative; Mark all as read clears the list. Notices hold the initiative and the gate, never the rationale. No email or Slack is sent. Migration `gate_notifications` (table `notifications`, triggers on `gate_reviews`, `mark_notifications_read`).
