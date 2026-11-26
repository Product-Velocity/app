---
bump: patch
type: fixed
---
**Fix: invited people are no longer joined as a Viewer by their email domain.** Someone invited as Admin (or any role) who confirmed their email at an authorized domain was made a Viewer first and the invitation could then not be accepted, and the admins were emailed "joined as a Viewer". A pending invitation now takes priority; the person gets the role they were invited with. Migration `20261126093034_invited_people_are_not_auto_joined`.
