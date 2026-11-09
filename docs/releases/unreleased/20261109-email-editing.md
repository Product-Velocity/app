---
bump: minor
---
**Edit product emails without a deploy (issue #370, phase 4).** Platform admins can change the wording of every product email in the Emails area: subject, preheader, heading, body, button label and footer note, with a live preview at desktop and phone width. Drafts do not change what is sent; publishing does, and restoring an older version creates a new one. Publish and restore are written to the platform audit log, and every version can be compared. A test send goes only to your own address, five an hour. Text only: no HTML, links or unknown macros, and if the wording cannot be read the built-in default is sent. Adds the migrations `email_template_versions` and `email_send_log_test_sends`.
