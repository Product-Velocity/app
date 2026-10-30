// "Do we already know this?" for the research step of a discovery or PRD (docs/27 section 6; the context-research rule in flow-rules.ts).
// The assistant lists the third parties and terms of a brief; this says which ones the workspace already holds (in the memory or the company
// profile), which are stale, and which still need research, so only those are researched. Pure.

import { PROFILE_STALE_DAYS, type ProfileSections } from "./company-profile";
import { daysBetween, memoryIsStale, significantWords, type MemoryRow } from "./memory";

export type ResearchHit =
  | { where: "memory"; id: string; kind: string; title: string; scope: string; verified_at: string; status: string; days_old: number; stale: boolean }
  | { where: "profile"; section: string; researched_at: string | null; days_old: number | null; stale: boolean };
export type ResearchGap = { term: string; status: "known" | "stale" | "missing"; hits: ResearchHit[] };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const whole = (hay: string, needle: string) => needle !== "" && ` ${hay} `.includes(` ${needle} `);

/** The most terms checked in one call; a longer list is cut, and the caller is told to ask the person which matter most. */
export const RESEARCH_TERMS_MAX = 20;

/**
 * For each term: "known" when a fresh note (title or tag) or a profile section that names it exists, "stale" when the only matches are older
 * than 90 days, "missing" otherwise. A note that only mentions the term in its body is a weaker hit: it is listed but does not make the term known.
 */
export function researchGaps(
  terms: readonly string[],
  memories: readonly MemoryRow[],
  profile: { sections: ProfileSections; researched_at: string | null } | null,
  now: Date,
): ResearchGap[] {
  const sections: [string, string][] = profile ? (["partners", "glossary", "products", "competitors", "position", "industry"] as const).filter((k) => profile.sections[k]).map((k) => [k, norm(profile.sections[k]!)]) : [];
  const profileAge = profile?.researched_at ? daysBetween(profile.researched_at, now) : null;
  return terms.slice(0, RESEARCH_TERMS_MAX).map((raw) => {
    const term = raw.trim();
    const needle = norm(term);
    const hits: ResearchHit[] = [];
    let fresh = false;
    let old = false;
    if (needle) {
      for (const m of memories) {
        if (m.status === "archived") continue;
        const inTitle = whole(norm(`${m.title} ${m.tags.join(" ")}`), needle);
        const inBody = !inTitle && whole(norm(m.body), needle);
        if (!inTitle && !inBody) continue;
        const stale = memoryIsStale(m, now);
        hits.push({ where: "memory", id: m.id, kind: m.kind, title: m.title, scope: m.scope, verified_at: m.verified_at, status: m.status, days_old: daysBetween(m.verified_at, now), stale });
        if (inTitle) { if (stale) old = true; else fresh = true; }
      }
      for (const [key, body] of sections) {
        if (!whole(body, needle) && !(significantWords(term).length > 1 && significantWords(term).every((w) => body.includes(w)))) continue;
        const stale = profileAge !== null && profileAge > PROFILE_STALE_DAYS;
        hits.push({ where: "profile", section: key, researched_at: profile?.researched_at ?? null, days_old: profileAge, stale });
        if (key === "partners" || key === "glossary" || key === "products" || key === "competitors") { if (stale) old = true; else fresh = true; }
      }
    }
    return { term, status: fresh ? "known" : old ? "stale" : "missing", hits };
  });
}
