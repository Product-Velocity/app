import { FLOW_LIFECYCLE, type Table } from "@/components/help-content";
import { HelpPage, HelpTable } from "@/components/help/help-ui";

export const metadata = {
  title: "Phase by phase · Help · Product Velocity",
  description: "For each of the seven phases: the question, the work, the evidence kept, and how Product Velocity and AI co-workers help.",
};

// Ashu's "Lifecycle and Gates" artifact: one column per phase, in order Discover, Define, Build, Test, Experiment, Roll-out, Completed.
const MATRIX: Table = {
  head: ["", "Discover", "Define", "Build", "Test", "Experiment", "Roll-out", "Completed"],
  rows: [
    ["The question", "Is this worth solving?", "What will we build, for whom, and why?", "Can we deliver it?", "Does it work as intended?", "Does it move the number?", "Are we ready to go to market and scale?", "Did it deliver the impact we expected?"],
    ["How we work", "Understand the customer problem with evidence from customers, data and the market.", "Align on the what, why, expected outcomes and how, with customers, sales and engineering.", "Teams deliver in their own delivery platforms. Leadership sees progress without status meetings.", "Verify with acceptance checks and a limited group of real users.", "Test the idea against a control group, with a success threshold agreed beforehand.", "Go to market with sales, support and education ready.", "Measure the outcome at 30, 60 and 90 days against the expected impact. Write down what you learned."],
    ["What we keep", "Discovery document", "PRD, with an optional technical assessment", "Epics and tasks in GitHub or Jira", "A completed test script", "The experiment result against the threshold", "Go-to-market plan and launch materials", "Outcome review and learning"],
    ["In Product Velocity", "The initiative stays out of the tracker. Duplicate check", "Stack rank, capacity fit, alignment. Optional review push to the tracker", "Two-way sync with GitHub or Jira. Progress and build status shown read-only", "Suggests the move to Test when the build is done", "Time in phase and stalled flags", "Go-to-market readiness, customers live and adoption", "Sync stops 14 days after completion"],
    ["AI co-workers help", "Draft the discovery document, summarise the evidence", "Draft the PRD, point out gaps, prepare the gate pack", "Propose epics and tasks for review", "Summarise results and open issues", "Summarise results against the threshold", "Draft go-to-market and enablement material", "Prepare the outcome review"],
  ],
};

export default function PhasesHelp() {
  return (
    <HelpPage current="phases" title="Phase by phase" intro="The seven phases side by side, and what ends each one. Sunset comes after Completed, for a shipped feature being retired, and needs no gate. The picture and the rules of the gates are on the lifecycle page; every status value is on Phases and statuses: the lists.">
      <HelpTable caption="Each phase: the question, the work, the evidence and what helps" table={MATRIX} />
      <HelpTable caption="Phases and what ends them" table={FLOW_LIFECYCLE} />
    </HelpPage>
  );
}
