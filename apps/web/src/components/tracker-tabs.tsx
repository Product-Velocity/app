import Link from "next/link";
import { TRACKER_SECTIONS, type TrackerSection } from "@/lib/tracker-fields/sections";

export { TRACKER_SECTIONS };
export type { TrackerSection };

/**
 * The five sections of a delivery tracker's settings, in setup order (decision 2026-11-16-tracker-settings-sections), at
 * `/settings/integrations/<tracker>` and its `/projects`, `/mapping`, `/inbox` and `/logs`. The same bar, with the same labels, on GitHub and Jira.
 * Until a connection works only "Connection" is a link; the others say why they are not. `badges` shows a count next to a tab (the inbox).
 */
export function TrackerTabs({ base, current, tracker, connected = true, badges = {} }: { base: string; current: TrackerSection; tracker: string; connected?: boolean; badges?: Partial<Record<TrackerSection, number>> }) {
  return (
    <nav aria-label={`${tracker} settings sections`} className="sub-tabs">
      {TRACKER_SECTIONS.map((s, n) => {
        const locked = s.needsConnection && !connected;
        const badge = badges[s.id];
        const body = (
          <>
            <span className="sub-tab-n" aria-hidden="true">{n + 1}</span>
            {s.label}
            {badge ? <span className="tab-badge" aria-label={`${badge} waiting`}>{badge}</span> : null}
          </>
        );
        return locked ? (
          <span key={s.id} className="sub-tab sub-tab-locked" aria-disabled="true" title={`Connect ${tracker} first`}>
            {body}<span className="visually-hidden"> (connect {tracker} first)</span>
          </span>
        ) : (
          <Link key={s.id} href={`${base}${s.suffix}`} className={current === s.id ? "sub-tab sub-tab-active" : "sub-tab"} aria-current={current === s.id ? "page" : undefined}>
            {body}
          </Link>
        );
      })}
    </nav>
  );
}
