import { FLOW_READ, STATUS_FROM_TRACKER, STATUS_INTRO, STATUS_NEXT_IN_PV, STATUS_NOTES, STATUS_TO_TRACKER, UPDATE_LEGEND } from "@/components/help-content";
import { HelpList, HelpPage, HelpSection, HelpTable } from "@/components/help/help-ui";

export const metadata = {
  title: "Sync steps and status rules · Help · Product Velocity",
  description: "How to connect GitHub or Jira step by step, what flows each way, how fresh the data is, and which status changes where.",
};

export default function SyncRulesHelp() {
  return (
    <HelpPage
      current="sync-rules"
      title="Sync steps and status rules"
      intro="The detail behind the delivery platforms topic. GitHub and Jira follow the same steps and the same rules."
      toc={[{ id: "steps", label: "Connect and sync" }, { id: "flows", label: "What flows each way" }, { id: "fresh", label: "How fresh the data is" }, { id: "status", label: "Status changes" }]}
    >
      <HelpSection id="steps" title="Connect and sync, step by step">
        <HelpTable caption="Step by step" table={FLOW_READ} />
      </HelpSection>
      <HelpSection id="flows" title="What flows each way">
        <HelpTable
          caption="Outbound and inbound"
          table={{
            head: ["Direction", "What", "When"],
            rows: [
              ["Product Velocity to the tracker", "Name, summary, description, hypothesis, a few labels (for example the rank band, MoSCoW, group and type), the milestone or due date, and links to shared documents", "Only after you confirm in Sync, and only for initiatives past Gate B (or an optional engineering review while the PRD is in review)"],
              ["The tracker to Product Velocity", "Issue and build status, progress from child issues, blocked and stale work, last activity, linked pull requests, CI status, the latest release, assignees and dates", "Real time by webhook, repaired by a daily check, and when you press Sync"],
              ["Never", "Value, confidence, customer names and requests, decisions and their reasons, objectives, key results and outcomes", "Never. A test fails the build if one appears in a payload"],
            ],
          }}
        />
      </HelpSection>
      <HelpSection id="fresh" title="How fresh the data is">
        <p>{UPDATE_LEGEND}</p>
      </HelpSection>
      <HelpSection id="status" title="Status changes: what changes, when, where">
        <p>{STATUS_INTRO}</p>
        <HelpTable caption="From Product Velocity to GitHub or Jira (written only after you confirm)" table={STATUS_TO_TRACKER} />
        <HelpTable caption="From GitHub or Jira to Product Velocity (read, never written back)" table={STATUS_FROM_TRACKER} />
        <HelpTable caption="What triggers a change inside Product Velocity" table={STATUS_NEXT_IN_PV} />
        <HelpList items={STATUS_NOTES} />
      </HelpSection>
    </HelpPage>
  );
}
