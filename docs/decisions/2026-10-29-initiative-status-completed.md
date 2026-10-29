---
date: 2026-10-29
by: Ashu
request: 247
---
**Initiative Status is Active, On hold, Completed, Cancelled.** A finished initiative with a blank status read as unknown, and Active did not fit, so Completed is back (it is the counterpart of Cancelled: the two ways an initiative ends). It is set by people. Initiative Phase still says where the initiative is in the lifecycle; Build Status Done still only means the build is finished. The migration `20261029094141_initiative_status_completed.sql` fills Completed for initiatives whose phase is already Completed or Sunset and whose status is blank. Still to build with the gates (slice 3): when the phase moves to Completed or Sunset, Needs attention suggests setting Initiative Status to Completed (a suggestion, never automatic). This changes the value list in the 2026-10-28 status decision (item 4).
