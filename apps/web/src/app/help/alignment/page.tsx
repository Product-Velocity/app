import { HelpCallout, HelpCards, HelpList, HelpPage, HelpSection, HelpTable, HelpWhere } from "@/components/help/help-ui";

export const metadata = {
  title: "Alignment · Help · Product Velocity",
  description: "How to agree on priorities with a small team or with hundreds of people: the initiative panel, decision gates, and anonymous alignment sessions.",
};

export default function AlignmentPage() {
  return (
    <HelpPage
      current="alignment"
      title="Alignment"
      intro="Priorities hold when the people who build, sell and fund them have a say. Product Velocity gives small groups a quick way to decide together, and large groups a way to vote that stays anonymous."
      toc={[
        { id: "choose", label: "Choosing a tool" },
        { id: "small", label: "Small groups" },
        { id: "large", label: "Large groups: alignment sessions" },
        { id: "run", label: "Running a session" },
        { id: "results", label: "From votes to the roadmap" },
        { id: "privacy", label: "Privacy" },
      ]}
    >
      <HelpSection id="choose" title="Choosing a tool">
        <HelpTable
          caption="Which tool for which group"
          table={{
            head: ["Group", "Use", "What you get"],
            rows: [
              ["A product team, a few people", "The initiative side panel, the Decisions tab and the global Stack Rank", "A conversation on the initiative itself, and a decision with its reason on record"],
              ["Leadership", "Decision gates A, B and C", "A named person with approval rights says Go, Go with conditions, Hold or Stop"],
              ["A department, a region, a customer group", "An alignment session", "An anonymous ranking from many people, shown by group, with a suggested order"],
            ],
          }}
        />
      </HelpSection>

      <HelpSection id="small" title="Small groups">
        <HelpCards
          columns={3}
          items={[
            { title: "Work on the initiative", text: "Open an initiative in the side panel. The Overview, Spec, Alignment and Activity tabs hold its fields, documents, vote results and history, so the discussion stays with the work." },
            { title: "Rank in one place", text: "One global Stack Rank across all projects. Project views show the local order, for example third overall and first in Platform." },
            { title: "Decide at a gate", text: "At Gate A, B or C a person with approval rights decides. The rationale is written once and never edited. Conditions become tasks that are tracked." },
          ]}
        />
        <HelpWhere>Grid (drag to re-rank), side panel (J and K move to the next initiative), Decisions tab.</HelpWhere>
      </HelpSection>

      <HelpSection id="large" title="Large groups: alignment sessions">
        <p>An alignment session asks a chosen group of people to rank a set of initiatives. Participants need no account: each gets a personal link by email. You pick the method.</p>
        <HelpTable
          caption="The three methods"
          table={{
            head: ["Method", "How a person votes", "Best for"],
            rows: [
              ["Top 5, then duels", "Pick the five most important initiatives, then settle close calls in head-to-head duels", "Quick ranking from busy people"],
              ["100 coins", "Spend 100 coins across the initiatives, with a maximum per initiative", "Showing how strongly people feel, not only the order"],
              ["ICE sliders", "Score impact, confidence and ease for each initiative", "A structured score people can compare and explain"],
            ],
          }}
        />
        <HelpWhere>Alignment tab. New session opens an initiative picker with filters for planned quarter, MoSCoW and stage (Discover, PRD, Ready for build). You can also start one from the grid with the initiatives you selected.</HelpWhere>
      </HelpSection>

      <HelpSection id="run" title="Running a session">
        <HelpCards
          columns={4}
          items={[
            { number: "01", title: "Set up", text: "Choose the initiatives, the method, the groups (such as role, region or customer type), how groups are weighted, when it closes and how long personal data is kept." },
            { number: "02", title: "Invite", text: "Add participants. An AI co-worker can draft the invitation. Nothing is sent until you confirm." },
            { number: "03", title: "Vote", text: "Each person opens their link on a phone or computer, gives consent and votes. They can change their vote until the session closes." },
            { number: "04", title: "Close and read", text: "Closing stores a snapshot of the results. Who voted is visible to admins; what each person voted is not shown unless an admin chooses Show names, which asks for a reason and is logged." },
          ]}
        />
      </HelpSection>

      <HelpSection id="results" title="From votes to the roadmap">
        <HelpList
          items={[
            "Each initiative shows its crowd result on the Alignment tab of the side panel: score, place, whether it is contested, and the session and date. The grid has the Crowd Rank, Crowd Score, Consensus and Votes columns.",
            "The session gives a suggested order. An admin can adjust it, record why the final order differs from the crowd's, and apply it to Stack Rank. Every application is audited and can be undone.",
            "The vote informs and leadership decides. Applying a result is a plain admin action; it does not replace a decision gate.",
          ]}
        />
        <HelpCallout title="People decide.">
          An AI co-worker can set up a session and draft the invitation text, and can read the anonymous results of a closed session. It cannot see who voted or what they voted, and it never ranks for you.
        </HelpCallout>
      </HelpSection>

      <HelpSection id="privacy" title="Privacy">
        <HelpTable
          caption="Who sees what in an alignment session"
          table={{
            head: ["Who", "Sees", "Never sees"],
            rows: [
              ["Participant", "The initiatives they vote on, their own votes and, if the admin allows it, anonymous results after the session closes", "Other people's votes, names or emails"],
              ["Workspace member", "Closed sessions that show results, as anonymous totals", "Draft sessions, who was invited, names, votes"],
              ["Admin", "The participant list, who has voted, and names per vote through Show names (logged, with a reason)", "A ranked list of people: nothing ranks people"],
            ],
          }}
        />
        <HelpList
          items={[
            "Groups with fewer than five voters are hidden. If hiding one group would reveal another, small groups are merged into Other, and Other is shown only with five or more voters.",
            "During an open session participants see no results, so nobody can tell who moved a total.",
            "Participants see what is collected, who can see it and how long it is kept before they vote. Personal data is deleted after the retention time you set; the anonymous totals stay.",
            "A person can be removed on request. Their vote stays as an anonymous vote and the totals do not change.",
          ]}
        />
      </HelpSection>
    </HelpPage>
  );
}
