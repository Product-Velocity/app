import { SyncFigure } from "@/components/help/figures";
import { HelpCallout, HelpCards, HelpList, HelpPage, HelpReference, HelpSection, HelpWhere } from "@/components/help/help-ui";

export const metadata = {
  title: "Delivery platforms · Help · Product Velocity",
  description: "How Product Velocity connects to GitHub and Jira, what flows each way, and how it gives one view of what is happening and when.",
};

export default function DeliveryHelp() {
  return (
    <HelpPage
      current="delivery"
      title="Delivery platforms"
      intro="Your teams keep working in GitHub and Jira. Product Velocity connects them, adds the priorities, decisions and goals that do not belong in a delivery tool, and shows what is happening and when from one place."
      toc={[
        { id: "idea", label: "Works with, not instead of" },
        { id: "steps", label: "Connect and sync" },
        { id: "flows", label: "What flows each way" },
        { id: "fresh", label: "How fresh the data is" },
        { id: "view", label: "One view of what and when" },
        { id: "rules", label: "Rules that protect your plan" },
      ]}
    >
      <HelpSection id="idea" title="Works with, not instead of">
        <HelpCards
          columns={3}
          items={[
            { title: "GitHub", text: "Install the GitHub App, choose repositories. Each initiative gets a tracking issue; epics and tasks are its sub-issues. An organisation Project board can be linked." },
            { title: "Jira", text: "Connect your Atlassian site, choose the Jira projects and their mapping. Each initiative links to a Jira issue, and its children are read for progress. An admin can set a project to read only: nothing is then written to Jira, and the epics you list on an initiative are read and their status rolls up." },
            { title: "The same for both", text: "GitHub and Jira have the same connection screens, the same steps, the same sync actions and the same rules. GitLab is planned." },
          ]}
        />
        <HelpReference slug="jira-setups">Jira setups: epics as initiatives, initiatives with tracked epics, many Jira projects, read only or send and sync</HelpReference>
        <HelpWhere>Account menu, Workspace admin, Integrations. Connect an AI assistant is a separate page in the same menu.</HelpWhere>
      </HelpSection>

      <HelpSection id="steps" title="Connect and sync">
        <HelpCards
          columns={3}
          items={[
            { number: "01", title: "Connect", text: "Link GitHub or Jira and choose the repositories or projects.", pills: ["Workspace admin"] },
            { number: "02", title: "Choose and pull in", text: "Each issue is Not pulled, Pulled in or Ignored. Nothing is pulled in by itself. A pulled-in issue becomes an initiative." },
            { number: "03", title: "Clean up and own", text: "Rename, merge duplicates, regroup, rank and add value. Take ownership to send the name, summary, description and hypothesis." },
          ]}
        />
        <HelpReference slug="sync-rules">The steps in full, with where to find each one</HelpReference>
      </HelpSection>

      <HelpSection id="flows" title="What flows each way">
        <SyncFigure />
        <HelpList
          items={[
            "Out: name, summary, description, hypothesis, a few labels, the milestone or due date and links to shared documents. Only after you confirm, and only past Gate B.",
            "In: issue and build status, progress, blocked and stale work, pull requests, CI, releases, assignees and dates.",
            "Never: value, confidence, customer names and requests, decisions, objectives, key results and outcomes.",
          ]}
        />
        <HelpReference slug="sync-rules">What flows each way, in a table, and which status changes where</HelpReference>
        <HelpCallout title="A closed ticket means the build is complete, not the initiative.">
          Initiative Phase and Initiative Status are set by people. The tracker never sets them. When the build is done, Product Velocity suggests moving to Test and you accept with one click.
        </HelpCallout>
      </HelpSection>

      <HelpSection id="fresh" title="How fresh the data is">
        <p>Data arrives in three ways: a webhook the moment something changes in the tracker, a daily check that repairs any difference, and the Sync button, which also reads the tracker first. Nothing is written back until you confirm.</p>
      </HelpSection>

      <HelpSection id="view" title="One view of what is happening and when">
        <HelpCards
          columns={3}
          items={[
            { title: "Grid: Delivery view", text: "Build status, tracker status, progress, schedule variance, G2M slip, blocked and stale issues, open pull requests, CI, assignees, last sync." },
            { title: "Gantt", text: "Initiatives on a timeline, grouped two levels deep. Drag a bar to move its dates, with undo. Views keep your grouping and zoom." },
            { title: "Cards", text: "The roadmap in swimlanes, grouped by what matters to you." },
            { title: "Needs attention", text: "Blocked, stalled, or out of step with the tracker, with the reason in words and the next step." },
            { title: "Roadmap Health and Changes", text: "Where work piles up and how long it waits. Which initiatives changed this week, and where each change came from." },
            { title: "Leadership", text: "The portfolio in one page, with the tracker's build status next to the phase." },
          ]}
        />
        <HelpWhere>Header tabs: Grid, Gantt, Cards, Leadership, Needs attention, Reports.</HelpWhere>
      </HelpSection>

      <HelpSection id="rules" title="Rules that protect your plan">
        <HelpList
          items={[
            "Nothing is written to GitHub or Jira until you see a preview and confirm. An issue that is only followed is never changed.",
            "Tracker-driven columns (build status, progress, pull requests, CI) are read-only in the app and never bulk-editable.",
            "Sync starts at Gate B. Discover never syncs. Syncing stops 14 days after an initiative is Completed or Cancelled, and an approver or admin can resume it.",
            "A shared document goes to the issue as its name and a link, not its text, and only to private repositories. Choose Do not share on a document to keep it out.",
            "The audit log records every change with who, when, where it came from and the old and new value.",
          ]}
        />
        <HelpReference slug="columns">Every column and how it syncs with GitHub and Jira</HelpReference>
      </HelpSection>
    </HelpPage>
  );
}
