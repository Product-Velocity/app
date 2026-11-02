---
issue: 286
status: done
logged: 2026-11-02
title: Account menu separated into what every member, a workspace admin and the platform owner can use
---
Ashu asked to rework the avatar menu so it clearly separates the features for an account or project user, an account admin and the platform owner. Built as proposed on the issue:

1. **This workspace** (everyone): Incoming issues, Alignment, Trash (creators and admins), Members, Initiative Groups, Company profile. The last three are read only for people who cannot change them.
2. **You** (everyone): Account, Security, Connect an AI assistant.
3. **Workspace admin** (human admins only): Workspace settings, Audit log, GitHub, Jira.
4. **Platform owner** (platform admins only): All accounts console, Platform audit log, Access settings. A platform admin working inside a customer account sees only "This account's audit log" there, and no admin section.

Sign out sits below the sections. A section a person may not use is not shown. Help text that names a menu location is updated.
