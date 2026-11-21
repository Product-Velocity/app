---
date: 2026-11-21
by: Ashu
request: 574
---
**The new visual homepage replaces the default website at `/`; the previous one stays available at `/classic`.**

- **Why:** the site should be more visual and show what to expect. The copy Ashu liked stays; the design changes (hero, product frame, Why now, three reporting charts). Prototyped in chat first (claude.ai artifact 118aa47f), then built.
- **`/`** is the new homepage (`apps/web/src/app/(marketing)/home.tsx`, styles scoped under `.pv2` in `marketing-v2.css`, static pictures in `art-v2.ts`). Headline "Deliver bigger, better outcomes. Faster."; eyebrow "Agentic product management platform".
- **`/classic`** is the previous homepage (`home-classic.tsx`), unchanged apart from dropping its structured data. It is **noindex, canonical to `/`**, left out of `sitemap.xml`, `llms.txt` and the robots allow list, and linked from nowhere. Delete it when nobody needs it.
- **SEO and AI discovery carry over to `/`:** title and description with "agentic product management", canonical, Open Graph and Twitter card (the share image uses the new headline), schema.org (Organization, WebSite, SoftwareApplication with a feature list), `sitemap.xml`, `robots.txt` (the same public paths now also named for the AI crawlers GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, Claude-User, PerplexityBot, Google-Extended and Applebot-Extended), `llms.txt`, and a new `llms-full.txt` built from the same markup as the page.
- **Google Tag Manager** loads on both pages, only when `NEXT_PUBLIC_GTM_ID` is a real container id, with Consent Mode v2 starting denied (unchanged). The consent banner in the container is still on the go-live list.
- **Light theme only**, like the app and the classic page (the prototype's dark mode was dropped).
- **The sign-in side keeps its current wording** (`AUTH_BRAND`, which matches the classic hero). Aligning it with the new hero is a separate change if Ashu wants it.
- **To check before go-live:** "agentic product management platform" as a trademark and as a claim (no competitor comparison is made).
