import { type Table } from "@/components/help-content";
import { HelpCallout, HelpList, HelpPage, HelpSection, HelpTable } from "@/components/help/help-ui";

export const metadata = {
  title: "Phases and statuses: the lists · Help · Product Velocity",
  description: "Every value of Initiative Phase, Initiative Status, Health, Planning Status and Build Status, what each means, and how to set them in common cases.",
};

const LISTS: Table = {
  head: ["Field", "Who sets it", "Values, in order"],
  rows: [
    ["Initiative Phase", "People, through the gates (Completed follows Initiative Status)", "Discover · Define · Build · Test · Experiment · Roll-out · Completed · Sunset"],
    ["Initiative Status", "People only", "Backlog · Active · On hold · Completed · Cancelled"],
    ["Health", "People, for work in progress", "On Track · At Risk · Delayed · Blocked"],
    ["Planning Status", "People, only if you run planning cycles", "Backlog · Not started · Candidate · Included · Committed · Deferred · Dropped"],
    ["Build Status", "The tracker (GitHub or Jira). Read only here.", "Not started · In progress · Done · Cancelled"],
  ],
};

const MEANINGS: Table = {
  head: ["Field", "Value", "Meaning"],
  rows: [
    ["Initiative Status", "Backlog", "Not started and parked. Nobody is working on it and nothing is planned yet."],
    ["Initiative Status", "Active", "Being considered, shaped or built. This is the only value Needs attention and Roadmap Health count as live work."],
    ["Initiative Status", "On hold", "Was running and was paused on purpose. The reason belongs in a comment."],
    ["Initiative Status", "Completed", "Finished. Setting it (or choosing Completed in Move to next phase) moves the phase to Completed and clears Health. It passes no gate, so completing before Roll-out skips Gate C and you are told."],
    ["Initiative Status", "Cancelled", "Decided not to do it. Stopping a gate (Stop) sets it."],
    ["Health", "On Track", "The work is going as planned."],
    ["Health", "At Risk", "It may slip. Someone should look."],
    ["Health", "Delayed", "It has already slipped against its date."],
    ["Health", "Blocked", "It cannot move until something outside the team changes."],
    ["Initiative Phase", "Discover to Define", "An idea, then an idea being shaped into a PRD. Gates A and B end them."],
    ["Initiative Phase", "Build, Test", "Engineers deliver, then a limited release checks it works. A Creator moves between them."],
    ["Initiative Phase", "Experiment, Roll-out", "Try it on a population against a threshold (Gate C), then widen it to markets and customers."],
    ["Initiative Phase", "Completed", "Finished and measured: reviews at +30, +60 and +90 days."],
    ["Initiative Phase", "Sunset", "A shipped feature that is being retired. No gate. A Creator chooses it from Roll-out or Completed."],
  ],
};

const CASES: Table = {
  head: ["Case", "Initiative Phase", "Initiative Status", "Health", "Planning Status"],
  rows: [
    ["Idea nobody has started, parked", "Discover", "Backlog", "blank", "blank"],
    ["Being shaped, going well", "Define", "Active", "On Track", "blank"],
    ["Was running, paused for a reason", "where it stopped", "On hold", "blank", "blank"],
    ["Building, a dependency is late", "Build", "Active", "Delayed", "blank"],
    ["Building, waiting on another team's decision", "Build", "Active", "Blocked", "blank"],
    ["Live and rolling out well", "Roll-out", "Active", "On Track", "blank"],
    ["Shipped and finished", "Completed", "Completed", "blank", "blank"],
    ["Decided not to do it", "where it stopped", "Cancelled", "blank", "blank"],
    ["Feature being retired", "Sunset", "Active, then Completed", "blank", "blank"],
    ["Shortlisted for the next planning cycle", "Define", "Active", "blank", "Candidate"],
  ],
};

const COLOURS: Table = {
  head: ["Colour", "Means", "Values"],
  rows: [
    ["Green", "Fine or finished", "On Track · Completed · Done"],
    ["Blue", "In motion", "Active · In progress · Included · Committed"],
    ["Amber", "Needs a decision or a look", "At Risk · On hold · Deferred"],
    ["Red", "A problem", "Delayed"],
    ["Dark red", "The hardest problem", "Blocked"],
    ["Grey", "Not active", "Backlog · Not started · Candidate · Dropped · Cancelled"],
    ["Outlined, no fill", "Where it is in the lifecycle", "Every Initiative Phase value (Completed and Sunset in muted grey)"],
  ],
};

export default function StatusesHelp() {
  return (
    <HelpPage current="statuses" title="Phases and statuses: the lists" intro="Every value of the fields that say where an initiative is and how it is going, what each means, and how to set them in common cases. The values can be copied straight into a spreadsheet for an import."
      toc={[{ id: "lists", label: "The lists" }, { id: "meanings", label: "What each value means" }, { id: "cases", label: "How to set them" }, { id: "colours", label: "Colours" }, { id: "rules", label: "Rules of thumb" }]}>
      <HelpSection id="lists" title="The lists">
        <HelpTable caption="Fields, who sets them, and their values" table={LISTS} />
      </HelpSection>
      <HelpSection id="meanings" title="What each value means">
        <HelpTable caption="Meaning of each value" table={MEANINGS} />
      </HelpSection>
      <HelpSection id="cases" title="How to set them">
        <HelpTable caption="Common cases and the values to choose" table={CASES} />
      </HelpSection>
      <HelpSection id="colours" title="Colours">
        <HelpTable caption="What each pill colour means. The word is always shown, so colour is never the only signal." table={COLOURS} />
      </HelpSection>
      <HelpSection id="rules" title="Rules of thumb">
        <HelpList items={[
          "Backlog is for something that has not started. On hold is for something that was running and stopped. Use the one that is true.",
          "Fill Health only once work is under way, from Build on. Needs attention reminds you when an Active initiative from Build onward has none. Backlog and On hold are never reminded.",
          "Starting work means setting Initiative Status to Active. The phase still moves through the gates.",
          "Setting Initiative Status to Completed moves the phase to Completed. A closed ticket in GitHub or Jira only means the build is done, not the initiative.",
          "An initiative that is not started but ready for engineers is not a status: it is in Build with Ready for build shown and Build Status Not started.",
          "Planning Status is only for planning cycles (capacity, committing work to a cycle). If you do not run cycles, leave it blank.",
          "Initiative Status, Health and Planning Status are never sent to GitHub or Jira.",
        ]} />
        <HelpCallout title="One value, one meaning">
          If a list in an old spreadsheet mixes several ideas in one status column (for example Backlog, On Track and Paused together), split it: parked or paused goes in Initiative Status, how it is going in Health, and where it is in the lifecycle in Initiative Phase.
        </HelpCallout>
      </HelpSection>
    </HelpPage>
  );
}
