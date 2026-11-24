import Link from "next/link";
import { checklist, type ChecklistCounts } from "@/lib/onboarding";
import { dismissGetStarted } from "./get-started-actions";

/** The "Get started" card at the top of the roadmap for a new workspace's admin (issue #634). Closes for good with Dismiss, or when all three are done. */
export function GetStarted({ counts }: { counts: ChecklistCounts }) {
  const { items, done } = checklist(counts);
  return (
    <section className="get-started" aria-labelledby="get-started-h">
      <div className="get-started-head">
        <h2 id="get-started-h">Get started <span className="muted">({done} of {items.length} done)</span></h2>
        <form action={dismissGetStarted}><button className="btn btn-sm" type="submit">Dismiss</button></form>
      </div>
      <ul>
        {items.map((i) => (
          <li key={i.key} className={i.done ? "is-done" : ""}>
            <span className="get-started-mark" aria-hidden="true">{i.done ? "✓" : "○"}</span>
            <span>
              <Link href={i.href}>{i.label}</Link>{i.altHref && <> or <Link href={i.altHref}>{i.altLabel}</Link></>}
              <span className="sr-only">{i.done ? " (done)" : " (to do)"}</span>
              <span className="hint"> {i.hint}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="hint">
        Also useful: <Link href="/settings/claude">connect Claude</Link> · <Link href="/help" target="_blank">Help</Link> · <Link href="/contact" target="_blank">Ask us a question</Link>
      </p>
    </section>
  );
}
