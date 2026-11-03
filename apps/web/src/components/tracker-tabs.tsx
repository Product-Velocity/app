import Link from "next/link";

/**
 * The two sections of a delivery tracker's settings (decision 2026-11-03-tracker-field-config): "Connect and configure" at
 * `/settings/integrations/<tracker>` and "Sync logs" at `/settings/integrations/<tracker>/logs`. The same bar, with the same labels, on GitHub and Jira.
 */
export const TRACKER_SECTIONS = [
  { id: "configure", label: "Connect and configure", suffix: "" },
  { id: "logs", label: "Sync logs", suffix: "/logs" },
] as const;
export type TrackerSection = (typeof TRACKER_SECTIONS)[number]["id"];

export function TrackerTabs({ base, current, tracker }: { base: string; current: TrackerSection; tracker: string }) {
  return (
    <nav aria-label={`${tracker} settings sections`} className="tabs">
      {TRACKER_SECTIONS.map((s) => (
        <Link key={s.id} href={`${base}${s.suffix}`} className={current === s.id ? "tab tab-active" : "tab"} aria-current={current === s.id ? "page" : undefined}>
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
