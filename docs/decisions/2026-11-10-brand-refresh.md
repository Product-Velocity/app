---
date: 2026-11-10
by: Claude, from Ashu's updated brand guide
request: none (asked in chat; a GitHub issue and request file can be added)
status: applied, to confirm with Ashu
---
**New brand colour and logo applied across the platform.**

## Decided
- **Colour.** Brand blue `#2270ED` replaces `#3347D9` for fills, outlines, focus rings and the first chart colour. Brand-coloured **text** uses `#1A56C4` (the guide's `brand-strong`), because white on `#2270ED` is 4.6:1 but the blue itself falls to 4.4:1 as text on grey. Tints: `#E8F1FE` (selected rows, info pill) and a lighter `#F3F8FE`. Old CSS variable names (`--blue`, `--blue-text`, `--blue-tint-1/2`) stay and carry the new values; the guide's names (`--brand`, `--brand-strong`, `--brand-tint`, `--on-brand`, `--logo-blue`) are added and a test keeps them equal.
- **Logo.** Drawn from the guide's 256-unit geometry as an inline SVG component, not a raster: the name is live text in IBM Plex Sans semibold. Minimum 24px beside the name.
- **Icons.** Tile with rounded corners for `icon.svg`, `icon.png`, `favicon.ico`; `apple-icon.png` is a square full-bleed tile (iOS applies its own corner mask and would otherwise fill the transparent corners black).
- **Email.** Tile as a 2x PNG (96px shown at 48px) with the name as text beside it, in the shared layout and the three Supabase templates. **The three Supabase templates must be pasted into the dashboard again** (Authentication > Emails > Templates) and the new `/email/logo.png` deployed first.
- **GitHub label.** The managed `pv:removed` label colour becomes `2270ED`. Labels that already exist on a repository keep their old colour unless re-created; no sync behaviour changed and no commercial field is involved.

## Not changed
- The pill motif in the guide is marked "proposed"; not built here.
- `prototype/` is a design reference with fictional data and still shows the old indigo.
- Dark theme: the guide defines one for the website only; the app is light first.
