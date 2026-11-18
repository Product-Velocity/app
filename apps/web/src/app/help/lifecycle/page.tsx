import { GATES_INTRO, GATES_NOTES, GATES_OUTCOMES, GATES_STEPS, GATES_TABLE, LIFECYCLE_NOTES, STATUS_INTRO } from "@/components/help-content";
import { LifecycleFlow } from "@/components/help/lifecycle-flow";
import { HelpCallout, HelpList, HelpPage, HelpReference, HelpSection, HelpTable, HelpWhere } from "@/components/help/help-ui";

export const metadata = {
  title: "Lifecycle and decision gates · Help · Product Velocity",
  description: "The seven phases an initiative moves through, the three decision gates, who decides, and what Product Velocity and AI co-workers do at each step.",
};

export default function LifecyclePage() {
  return (
    <HelpPage
      current="lifecycle"
      title="Lifecycle and decision gates"
      intro="Every initiative moves through the same clear phases. People decide at three gates, and AI co-workers prepare the work. It does not end at shipped."
      toc={[
        { id: "phases", label: "The seven phases" },
        { id: "gates", label: "The three gates" },
        { id: "decide", label: "Request, decide, complete" },
        { id: "light", label: "Light touch and fast lane" },
        { id: "attention", label: "Needs attention" },
        { id: "status", label: "Three kinds of status" },
      ]}
    >
      <HelpSection id="phases" title="The seven phases">
        <LifecycleFlow />
        <HelpList items={LIFECYCLE_NOTES} />
        <HelpReference slug="phases">Phase by phase: the question, the work, the evidence and how AI co-workers help</HelpReference>
        <HelpCallout title="Why have a process at all?">
          It prevents costly mistakes that were easy to prevent. Big or costly work gets the full process. Small, low-risk work takes a light touch and can skip gates or phases. Nothing lives outside the roadmap.
        </HelpCallout>
      </HelpSection>

      <HelpSection id="gates" title="The three gates">
        <p>{GATES_INTRO}</p>
        <HelpTable caption="The three gates" table={GATES_TABLE} />
        <HelpTable caption="The four outcomes" table={GATES_OUTCOMES} />
        <HelpWhere>Decisions tab; Request gate, Decide and Move to next phase in the side panel, the multi-select bar and the command palette (Ctrl+K).</HelpWhere>
      </HelpSection>

      <HelpSection id="decide" title="Request, decide, complete">
        <HelpTable caption="How a gate runs" table={GATES_STEPS} />
        <HelpList items={GATES_NOTES} />
        <HelpCallout title="People decide. AI co-workers prepare.">
          An AI co-worker can prepare the gate pack, which is the checklist, the documents and the history of earlier decisions. It cannot request, decide or approve a gate, or move a phase. The decision and its reason are written once and never edited.
        </HelpCallout>
      </HelpSection>

      <HelpSection id="light" title="Light touch and fast lane">
        <p>Not every initiative needs every step. A person who decides can pick a later phase and tick Fast lane with a comment. The skipped phases and gates are recorded as skipped, so the roadmap still tells the truth. There are no size or confidence checks: it is your call.</p>
      </HelpSection>

      <HelpSection id="attention" title="Needs attention">
        <p>The Needs attention tab lists the initiatives that need a person to look, with the reason in words and the next step. Everything on it is a suggestion: nothing changes until you press a button. It is about initiatives, never about people.</p>
        <HelpReference slug="attention">Every reason an initiative appears on Needs attention</HelpReference>
      </HelpSection>

      <HelpSection id="status" title="Three kinds of status">
        <p>{STATUS_INTRO}</p>
        <HelpReference slug="sync-rules">Which status changes where, and what triggers it</HelpReference>
      </HelpSection>
    </HelpPage>
  );
}
