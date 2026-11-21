---
date: 2026-11-21
by: Ashu
request: 572
---
**The website and the app are separate.** `/` is always the public website. The app starts at `/app`.

- **Why:** `/` redirected every signed-in browser into the app, and "See the demo" signed the browser out of the person's own account and into the shared demo account, so the website kept sending them to the demo afterwards.
- **`/`** shows the website to everyone. A signed-in member sees "Open app" instead of "Sign in" and "See the demo"; someone in the demo account sees "Back to the demo". Both go to `/app`.
- **`/app`** holds the former redirect: the last screen and saved view in the account, or the leadership or portfolio view. Signed-out visitors are sent to sign in and return to `/app`.
- **The default place after signing in is `/app`** (sign-in, email link, MFA, password reset, OAuth consent without an id, the Help "Open the app" link). Exit demo and Sign out still go to the website or the sign-in page.
- **The demo never replaces a real session:** `/demo` redirects a signed-in member to `/app` and only signs signed-out visitors (or someone already in the demo account) into the demo account.
- The demo account is recognised by comparing the signed-in email with `DEMO_VIEWER_EMAIL` on the server; the address is never sent to the browser.
