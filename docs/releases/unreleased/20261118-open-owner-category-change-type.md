---
bump: minor
---
**Owner and Roadmap Category are open lists, Change Type is renamed.** Owner and Roadmap Category now work like Focus Area: type any text, pick from the values already in use, or add a new one. Roadmap Category is shown again in the grid, panel, filters and views. Change Type is now Feature, Improvement, Bug or Tech debt (the old names move over; tracker labels keep their names). Claude says Owner, not Sponsor, and no longer insists on an email address for it. Migration `20261118213038_open_owner_category_change_type.sql` turns each existing owner into the member's email address.
