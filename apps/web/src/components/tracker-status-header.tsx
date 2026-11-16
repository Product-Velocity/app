import Link from "next/link";
import { TrackerTabs } from "@/components/tracker-tabs";
import { nextStep, sectionPath, type SetupStep, type TrackerSection } from "@/lib/tracker-fields/sections";

// The top of every GitHub and Jira settings section (decision 2026-11-16-tracker-settings-sections): the name, one line of state (a word as well as a colour),
// the counts that matter with a link to where to act, the next step while set-up is not finished, and the five sections. The same on both trackers.

export type StatusTone = "ok" | "warn" | "off";
export type StatusChip = { text: string; section?: TrackerSection; tone?: "warn" };

export function TrackerStatusHeader({ tracker, base, current, state, tone, summary, chips, steps, blurb, badges = {} }: {
  tracker: "GitHub" | "Jira";
  base: string;
  current: TrackerSection;
  /** The one-word state ("Connected", "Not connected", "Sign in again needed"). */
  state: string;
  tone: StatusTone;
  /** Where it is connected: the account or the site names. */
  summary?: string;
  chips: StatusChip[];
  steps: SetupStep[];
  blurb?: string;
  badges?: Partial<Record<TrackerSection, number>>;
}) {
  const next = nextStep(steps);
  return (
    <>
      <section className="status-header" aria-label={`${tracker} status`}>
        <h1>{tracker}</h1>
        <span className={`status-pill status-${tone}`}>{state}</span>
        {summary && <span className="muted">{summary}</span>}
        {chips.length > 0 && (
          <ul className="status-chips">
            {chips.map((c) => (
              <li key={c.text} className={c.tone === "warn" ? "chip-warn" : undefined}>
                {c.section ? <Link href={sectionPath(base, c.section)}>{c.text}</Link> : c.text}
              </li>
            ))}
          </ul>
        )}
        {next && next.section !== current && (
          <Link className="btn btn-primary status-next" href={sectionPath(base, next.section)}>Next: {next.label}</Link>
        )}
      </section>
      {blurb && <p className="muted">{blurb}</p>}
      <TrackerTabs base={base} current={current} tracker={tracker} connected={steps[0]?.done ?? false} badges={badges} />
    </>
  );
}

/** The first-run checklist: shown on the Connection section until set-up is complete. */
export function SetupSteps({ steps, base }: { steps: SetupStep[]; base: string }) {
  const next = nextStep(steps);
  return (
    <div className="card stack">
      <h2>Set-up</h2>
      <ol className="steps">
        {steps.map((s, n) => (
          <li key={s.id} className={s.done ? "step-done" : next?.id === s.id ? "step-next" : undefined}>
            <span className="step-mark" aria-hidden="true">{s.done ? "✓" : n + 1}</span>
            <span>
              {s.section === "connection" ? s.label : <Link href={sectionPath(base, s.section)}>{s.label}</Link>}
              <span className="visually-hidden">{s.done ? " (done)" : next?.id === s.id ? " (next)" : s.optional ? " (optional)" : " (to do)"}</span>
              {!s.done && s.optional && <span className="muted"> · optional</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
