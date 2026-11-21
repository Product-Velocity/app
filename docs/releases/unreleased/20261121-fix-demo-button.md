---
bump: patch
---
**Fix: the "See the demo" button in the header nav was invisible on some screens.** A header style rule forced every button there to white text, which made the "See the demo" button unreadable next to "Get early access" (it only ever belonged in the hero, which already has it). Also adds a `reason` on the `/demo` redirect when sign-in fails, to make the next report easier to diagnose.
