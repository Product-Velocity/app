import { HelpCallout, HelpCards, HelpList, HelpPage, HelpReference, HelpSection, HelpWhere } from "@/components/help/help-ui";

export const metadata = {
  title: "Goals and impact · Help · Product Velocity",
  description: "How objectives and key results connect company goals to initiatives on the roadmap, and how the impact of each initiative is measured after launch.",
};

const CHAIN = [
  { number: "01", title: "Business line", text: "The part of the company that owns the outcome, for example Programmatic, Direct or Platform. An open list: type any name, and the names already in use are offered.", pills: ["Business Line column"] },
  { number: "02", title: "Objective", text: "The outcome you want, written in full in your own words. Open list, up to 120 characters. Several initiatives can serve the same objective.", pills: ["Objective column"] },
  { number: "03", title: "Key result", text: "How you will know. Each initiative names one primary key result with a unit, a direction, a start value and a target.", pills: ["Primary KR", "Start", "Target"] },
  { number: "04", title: "Initiative", text: "The work on the roadmap. It carries its objective and its key result, so the reason it is there is visible next to its rank, phase and health.", pills: ["Roadmap row"] },
];

export default function OkrsPage() {
  return (
    <HelpPage
      current="okrs"
      title="Goals and impact"
      intro="Teams are busy and shipping. Objectives and key results make sure the work moves the numbers that matter, and show why each initiative is on the roadmap."
      toc={[
        { id: "why", label: "Why goals" },
        { id: "chain", label: "How the pieces fit" },
        { id: "test", label: "The test for every initiative" },
        { id: "measure", label: "Measuring impact" },
        { id: "use", label: "Using it day to day" },
        { id: "rules", label: "What to know" },
      ]}
    >
      <HelpSection id="why" title="Why goals on the roadmap">
        <HelpCards
          columns={4}
          items={[
            { number: "01", title: "Grow our impact", text: "Focus on a few outcomes that move revenue and margin, not a long list of requests.", pills: ["Fewer priorities", "Measurable results"] },
            { number: "02", title: "Link strategy", text: "Strategy sets the direction. Objectives turn it into outcomes. Initiatives deliver them.", pills: ["Strategy", "Objectives", "Initiatives"] },
            { number: "03", title: "One simple test", text: "Every initiative must move a key result. That makes prioritising, and saying no, easier.", pills: ["Which KR does it move?"] },
            { number: "04", title: "One language", text: "The same words for every business line and every review, in one place.", pills: ["One owner", "One review"] },
          ]}
        />
        <HelpCallout title="From features shipped to outcomes moved.">
          The roadmap stays the plan. Goals tell you why each item is on it and how you know it worked.
        </HelpCallout>
      </HelpSection>

      <HelpSection id="chain" title="How the pieces fit together">
        <p>Each level answers the one above it, down to the work on the roadmap.</p>
        <HelpCards columns={4} items={CHAIN} />
        <HelpWhere>Grid, side panel (Overview tab), bulk bar, Columns picker. The Leadership view shows Business Line and Objective by default, after Business Value Type.</HelpWhere>
        <HelpList
          items={[
            "Objective and Business Line are independent. Choosing one does not filter or fill the other, and an objective does not carry an owner or value of its own.",
            "Nothing is pre-filled. Your first values become the suggestions, and Product Velocity keeps one spelling for each value.",
            "An initiative has one primary key result. Add more detail in its documents, and keep the number you track in the key result columns.",
            "Business Owner is who owns the business case of the initiative, written as a name or an email address; the owners already in use are offered as you type. Name the people on the team in the PRD.",
            "Objectives and key results are strategy, so they are never sent to GitHub or Jira.",
          ]}
        />
      </HelpSection>

      <HelpSection id="test" title="The test for every initiative">
        <HelpCallout title="Which key result does it move?">
          If the answer is none, the initiative needs a reason to be on the roadmap. Ask the question at Gate A (worth defining?) and again at Gate B (commit to build?).
        </HelpCallout>
        <p>Fill in the Objective and Primary KR columns while you define the initiative. Then use them to see the roadmap by goal: filter or group by Objective or Business Line in the view bar, and compare how many initiatives serve each. Use the Leadership view for the version you show to leadership.</p>
      </HelpSection>

      <HelpSection id="measure" title="Measuring the impact of each initiative">
        <p>The story does not end at shipped. Every initiative keeps its expected impact next to its actual result, so you can see which bets paid off. Review the outcome at 30, 60 and 90 days after roll-out, and write down what you learned.</p>
        <HelpList
          items={[
            "What did we expect? Business Value Type, Value (12 months) and Confidence, set while you define the initiative.",
            "What happened to the key result? Realized KR Value, with % Realized KR Value calculated against your start and target.",
            "Did it deliver the value we predicted? Realized EUR per year, compared with the prediction.",
            "Is anyone using it? % Adoption, Customers Live, Roll-out %, Time to First Use and Retention.",
            "What is the verdict? Outcome Status, Outcome Verdict (Hit, Partial, Miss, Too early) and what you learned.",
          ]}
        />
        <HelpReference slug="goal-fields">All goal and outcome fields, and where each is set</HelpReference>
        <HelpWhere>Columns picker: groups Why, Go-to-market and Outcomes. The saved view called Outcomes shows them together; Go-to-market shows adoption and roll-out.</HelpWhere>
        <p>What you learn becomes the next set of candidates in Discover, so each initiative makes the next plan better.</p>
      </HelpSection>

      <HelpSection id="use" title="Using it day to day">
        <HelpList
          items={[
            "Link an initiative to a goal: open it and set Objective and Primary KR (metric, unit, direction, start, target). Or paste the columns from a spreadsheet and map them on import.",
            "Set the objective on many initiatives: select the rows, then set Objective in the bar above the grid.",
            "See everything that serves one objective: filter or group by Objective in the view bar.",
            "Brief leadership on goals: open Leadership, or save a view with Business Line, Objective, Health and Delivery Progress.",
            "Record how it went: open the Outcomes view and fill Realized KR Value, Outcome Status and Outcome Verdict at each review.",
            "Draft the goal with an AI co-worker: ask for a Discovery or PRD. The key result and its target are part of the document, and the fields can be filled from it.",
          ]}
        />
      </HelpSection>

      <HelpSection id="rules" title="What to know">
        <HelpList
          items={[
            "AI co-workers never set Stack Rank, Decision or Value. They can draft a key result for you to review.",
            "Everything is audited and can be undone with Ctrl+Z (⌘Z on a Mac).",
            "Commercial fields (value, confidence, customer names, decisions, key results and outcomes) are never sent to GitHub or Jira.",
            "Outcome and velocity insights describe teams and initiatives, never individual people.",
          ]}
        />
      </HelpSection>
    </HelpPage>
  );
}
