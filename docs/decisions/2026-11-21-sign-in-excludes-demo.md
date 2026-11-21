---
date: 2026-11-21
by: Ashu
request: 576
---
**`/sign-in` is a clean sign-in that the shared demo session never takes over; the demo has its own link, `/demo`.** A leftover demo session no longer redirects `/sign-in` into the app (a real session still does), signing in replaces it, and the website header and footer show "Sign in" next to "Back to the demo" for a demo session. Amends `2026-11-21-website-and-app-split.md`.
