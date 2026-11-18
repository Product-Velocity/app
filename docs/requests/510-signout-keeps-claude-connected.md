---
issue: 510
status: in progress
logged: 2026-11-18
title: Signing out of the web app must not disconnect the Claude connector
---
Ashu: the Claude connector keeps showing "Sign-in expired". Cause: web sign-out used Supabase's default global scope, which revokes the connector's OAuth session. Now `scope: "local"`; the account page's two bulk sign-out buttons say they also disconnect Claude. Supabase Auth settings (Free plan) have no time-box or inactivity limit; the refresh token reuse interval (10 s) can be raised to 300 s in the dashboard to tolerate parallel refreshes (Ashu's change).
