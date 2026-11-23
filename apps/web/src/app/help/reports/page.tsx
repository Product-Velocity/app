import { HelpCallout, HelpList, HelpPage, HelpReference, HelpSection, HelpTable, HelpWhere } from "@/components/help/help-ui";

export const metadata = {
  title: "Reporting · Help · Product Velocity",
  description: "Which view or report each audience should use, so leadership, product, delivery, go-to-market and approvers have what they need to act and decide.",
};

export default function ReportsHelp() {
  return (
    <HelpPage
      current="reports"
      title="Reporting"
      intro="Different people ask different questions. Each audience gets a view built to answer theirs, from the same roadmap, so nobody works from a stale copy."
      toc={[
        { id: "audiences", label: "Who uses what" },
        { id: "leadership", label: "Leadership view and weekly update" },
        { id: "reports", label: "The Reports tab" },
        { id: "views", label: "Saved views and sharing" },
      ]}
    >
      <HelpSection id="audiences" title="Who uses what">
        <HelpTable
          caption="Audiences, the question they ask, and where to look"
          table={{
            head: ["Audience", "The question", "Where to look", "What they can do with it"],
            rows: [
              ["Leadership", "Are we working on the right things, and are they on track?", "Leadership tab, then the weekly update", "Ask for a decision, remove a blocker, change a priority"],
              ["Product managers", "What needs me today?", "Needs attention, Decisions, the Grid", "Request a gate, move a phase, fix a missing field"],
              ["Approvers", "What is waiting for my decision, and what is the case for it?", "Decisions tab, Gate history report", "Go, Go with conditions, Hold or Stop"],
              ["Delivery and engineering", "Is the build on track, and what is blocked?", "Delivery view, Gantt, Roadmap Health", "Unblock work, reset a date, close the loop in the tracker"],
              ["Go-to-market, sales and support", "When does it land, and who is it for?", "Go-to-market view, Cards, Gantt", "Prepare launch material, tell customers"],
              ["Everyone after launch", "Did it work?", "Outcomes view", "Record the result, learn, feed the next plan"],
            ],
          }}
        />
      </HelpSection>

      <HelpSection id="leadership" title="Leadership view and weekly update">
        <p>The Leadership tab is a read-only, portfolio-level page. People with the Leadership viewer role land on it after signing in. It follows the scope switcher.</p>
        <HelpList
          items={[
            "Summary tiles: initiatives in scope, how many are On track, how many need attention, how many are due in the next two weeks.",
            "Portfolio health by project, in words and counts, never colour alone.",
            "Needs attention: Blocked, Delayed and At Risk initiatives and those past their go-to-market date, worst first, with the reasons.",
            "Top initiatives by global rank, in the columns of the Leadership view, including Business Line and Objective.",
            "What moved this week: phase moves, health changes and new documents, with the Jira or GitHub status beside Product Velocity's. It shows the net result over the week, not every change.",
            "Investment mix across the five roadmap categories.",
          ]}
        />
        <HelpCallout title="The weekly update writes itself from the data.">
          A creator or admin presses Draft weekly update. Every statement names its initiative, and each initiative, ticket and document is a link. Edit it, mark it reviewed, then use Copy for email: headings, lists and links survive the paste into Gmail or Outlook. Nothing is sent for you. Leadership viewers see the reviewed update only.
        </HelpCallout>
      </HelpSection>

      <HelpSection id="reports" title="The Reports tab">
        <p>The Reports tab has a list of reports next to its title. The filters and the click-to-filter pills are shared, so they stay when you switch reports, and the address keeps the report and the filters so you can share a link.</p>
        <HelpList
          items={[
            "Overview: the shape of the roadmap, and how long work takes to reach the market.",
            "Roadmap Health: where active work piles up, how long it has been in its phase, and what is Blocked, At Risk or Delayed.",
            "Gate history: what is waiting for a decision and what needs attention, what was decided, and how long decisions take compared with what is usual for your team. For the whole team, never per approver.",
            "Changes: which initiatives changed today, this week or this month, and where each change came from.",
            "Velocity: how long work takes from Start Discovery to roll-out, to each gate and in Build, how much it varies, where the time goes and how long gates take to decide. For the team, never per person.",
          ]}
        />
        <HelpWhere>Reports tab. Each chart has Show as table with the same numbers.</HelpWhere>
        <HelpReference slug="report-definitions">What is on each report, and how the numbers are counted</HelpReference>
      </HelpSection>

      <HelpSection id="views" title="Saved views and sharing">
        <HelpList
          items={[
            "Saved views remember the filters, grouping, sorting and columns. Ready-made views include Prioritisation, Discovery, Planning, Delivery, Go-to-market, Outcomes, Leadership, Timeline, History and Cycle review.",
            "The Grid, Gantt and Cards show the same initiatives in three ways: a table, a timeline and swimlanes. All three have the same view bar and the same views panel (the button at the end of the bar). In it, your bar is a list you can drag into order, admins can switch to the workspace bar for everyone, and each screen (Grid, Cards, Gantt) keeps its own views and its own bar. On the Gantt, Prioritisation, Planning and Delivery set the filters, grouping, zoom and row height, and your own saved views keep them too. Views are not shared between the Grid, Cards and Gantt: a view you save on one shows on that screen only.",
            "The address of a report keeps the report and its filters, so a link shows a colleague the same thing you see. They need an account in the workspace.",
            "Export a report's list to CSV, and paste from Excel to bring data in with column mapping.",
            "Each chart has an Export PNG button (it shows when you point at the chart, or tab to it): you get the chart with its title and nothing else added. Export PDF at the top of a report prints the whole page: choose Save as PDF in the print window. The PDF shows the filters in words and leaves out the menus.",
            "Roadmap, delivery and outcome reports in other formats (for example slides), and views safe to share with customers, are planned. Today, share a link to the view or copy the weekly update.",
          ]}
        />
        <HelpCallout title="No individual performance metrics.">
          Reports describe initiatives, teams and the portfolio. Nothing ranks or measures an individual, and gate history is for the whole team, never per approver.
        </HelpCallout>
      </HelpSection>

    </HelpPage>
  );
}
