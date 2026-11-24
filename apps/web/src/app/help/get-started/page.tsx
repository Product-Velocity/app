import { HelpCallout, HelpCards, HelpList, HelpPage, HelpReference, HelpSection } from "@/components/help/help-ui";
import { SetupFigure } from "@/components/help/figures";

export const metadata = {
  title: "Get started · Help · Product Velocity",
  description: "From your first sign-in to a first initiative that has passed its gates, step by step, with a short note for leaders.",
};

export default function GetStartedHelp() {
  return (
    <HelpPage
      current="get-started"
      title="Get started"
      intro="The route from your first sign-in to a first initiative that has been decided, built and measured. Each step names the page that explains it in full."
      toc={[{ id: "route", label: "The route" }, { id: "checklist", label: "First-run checklist" }, { id: "leaders", label: "A note for leaders" }]}
    >
      <HelpSection id="route" title="The route">
        <HelpCards
          columns={3}
          items={[
            { number: "01", title: "Set up", text: "Check the workspace and your company profile, connect an AI assistant and, when you are ready, GitHub or Jira.", href: "/help/ai-setup" },
            { number: "02", title: "Add initiatives", text: "Type a name and press Enter, paste from a spreadsheet, or ask an AI co-worker. A name is all you need to start.", href: "/help/okrs" },
            { number: "03", title: "Define", text: "Write Discovery and the PRD with an AI co-worker, and run a pre-mortem before a gate.", href: "/help/skills" },
            { number: "04", title: "Align and rank", text: "Agree the order with your team, or ask a larger group in an anonymous vote.", href: "/help/alignment" },
            { number: "05", title: "Decide", text: "A person with approval rights decides at the gates. AI prepares the gate pack and never decides.", href: "/help/lifecycle" },
            { number: "06", title: "Build, launch, learn", text: "Sync with your tracker, share the weekly update, and compare the result with the key result.", href: "/help/delivery" },
          ]}
        />
      </HelpSection>

      <HelpSection id="checklist" title="First-run checklist">
        <SetupFigure />
        <HelpList
          items={[
            "Connect an AI assistant and type pv-help to see what it can do.",
            "Ask the assistant to run research_company so your company profile exists. An admin confirms it; every skill reads it.",
            "Add three to five real initiatives. Do not fill every field; validation follows the stage, not creation.",
            "Pick one initiative and write its Discovery document, then its PRD, with an AI co-worker. Use --draft to read the result before anything is saved.",
            "Run pv-premortem on it before its first gate.",
            "Request the gate. The person who decides gets the gate pack.",
            "Connect GitHub or Jira only when an initiative has passed Gate B. Nothing is sent until you confirm.",
            "Share the weekly update with your leader.",
          ]}
        />
        <HelpReference slug="skills">Every AI skill, one page each</HelpReference>
        <HelpReference slug="ai-setup">Connect an AI assistant</HelpReference>
      </HelpSection>

      <HelpSection id="leaders" title="A note for leaders">
        <p>You do not need to learn the whole product. Open the Leadership view for health and what needs attention, read the weekly update, and decide at the gates that ask for you. If you can approve a gate, you receive the gate pack: the checklist, the documents and the history of earlier decisions.</p>
        <HelpCallout title="AI prepares, people decide.">An AI co-worker never approves a gate, sets Stack Rank, Value or Decision, or moves an initiative to the next phase.</HelpCallout>
        <HelpReference slug="reports">Reporting: what leadership sees</HelpReference>
      </HelpSection>
    </HelpPage>
  );
}
