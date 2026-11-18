import { HelpPage, HelpTable } from "@/components/help/help-ui";
import type { Table } from "@/components/help-content";

export const metadata = {
  title: "Goal and outcome fields · Help · Product Velocity",
  description: "The columns that record the expected impact, the key result and the outcome review of an initiative.",
};

const MEASURE: Table = {
  head: ["Question", "Columns", "Where they are set"],
  rows: [
    ["Which goal does it serve?", "Business Line, Objective, Primary KR (metric name, unit, direction, start value, target value), Owner", "You, while you define the initiative"],
    ["What did we expect?", "Business Value Type, Value (12 months), Confidence", "You, while you define the initiative. Value and Confidence are commercial and are never sent to GitHub or Jira"],
    ["What happened to the key result?", "Realized KR Value, % Realized KR Value (calculated), Measured Period", "You, at each review"],
    ["Did it deliver the value we predicted?", "Realized EUR per year, Value vs Prediction (%)", "You; the comparison is calculated"],
    ["Is anyone using it?", "% Adoption, Customers Live, Roll-out %, Time to First Use, Retention", "You, from the go-to-market and product data you have"],
    ["Where does the review stand?", "Outcome Status (Not yet due, On target, Behind, Missed, Exceeded), Outcome Review Date (calculated)", "You set the status; the review date is calculated"],
    ["What is the verdict, and what did we learn?", "Outcome Verdict (Hit, Partial, Miss, Too early), Learning", "You, at the review"],
  ],
};

export default function GoalFieldsHelp() {
  return (
    <HelpPage current="goal-fields" title="Goal and outcome fields" intro="The columns that connect an initiative to a goal and record how it turned out. Every one can be shown from the Columns picker. The saved views Outcomes and Go-to-market show them together. All of them are described in the full field reference too.">
      <HelpTable caption="What you record, and where" table={MEASURE} />
    </HelpPage>
  );
}
