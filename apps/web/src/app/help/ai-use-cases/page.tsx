import { AGENT_SKILL_INCLUDES, AGENT_SKILL_STEPS, AGENT_SKILL_TIERS, AGENT_SKILL_TIPS, AGENT_USE_CASES } from "@/components/help-content";
import { HelpList, HelpPage, HelpReference, HelpSection, HelpTable } from "@/components/help/help-ui";

export const metadata = {
  title: "AI use-cases and documents · Help · Product Velocity",
  description: "What to use an AI co-worker for, and where documents are used along the initiative lifecycle.",
};

export default function AiUseCasesHelp() {
  return (
    <HelpPage current="ai-use-cases" title="AI use-cases and documents" intro="The detail behind the AI co-workers topic: what an agent does at each step, and how a document is used from the first idea to the outcome review.">
      <HelpSection id="uses" title="What to use it for">
        <HelpTable caption="Use-cases, what the agent does, and where the result lands" table={AGENT_USE_CASES} />
      </HelpSection>
      <HelpSection id="skills" title="The pv- skills">
        <p>Every prompt and skill is named <code>pv-</code> and its name; the older names <code>write_prd</code>, <code>write_discovery</code> and <code>research_company</code> still work (now <code>pv-prd</code>, <code>pv-discovery</code> and <code>pv-company</code>) but are in no menu. Start a skill with <code>pv-</code> and its name, then what it is about, for example <code>pv-premortem R-12</code>, <code>pv-strategy</code> or <code>pv-weekly --format=email</code>. In Claude and Gemini pick it from the prompt menu; in ChatGPT type it. Every skill reads the company profile and what Product Velocity already stores, and asks once. Every question can be skipped, and nothing is invented: what it cannot find stays &ldquo;to define&rdquo;. Add <code>--draft</code> to see the result before anything is saved. Skills never set Stack Rank, Value, Confidence or Decision and never approve; a person decides.</p>
        <HelpTable caption="The kinds of skill, and where to start" table={AGENT_SKILL_TIERS} />
        <HelpTable caption="What a guided skill runs as steps" table={AGENT_SKILL_INCLUDES} />
        <HelpTable caption="Which skill when, along the product life cycle" table={AGENT_SKILL_STEPS} />
        <HelpReference slug="skills">One page for every skill: how to start it, what it asks, what it writes and what you decide</HelpReference>
        <h3>Getting the most out of them</h3>
        <HelpList items={AGENT_SKILL_TIPS} />
      </HelpSection>
      <HelpSection id="documents" title="Where documents are used along the lifecycle">
        <HelpTable
          caption="Documents along the lifecycle"
          table={{
            head: ["Phase", "Document", "How it is used"],
            rows: [
              ["Discover", "Discovery document", "Holds the problem, evidence, candidate solutions and expected impact. Approved at Gate A, which moves the initiative to Define"],
              ["Define", "PRD (spec, hypothesis, key result, roll-out and go-to-market plan)", "Written with an AI co-worker, aligned with the team, approved at Gate B. A short Description is extracted for you to confirm, and fills the fields it can"],
              ["Build", "The PRD, as a link", "A shared document goes into the GitHub issue or Jira description as its name and a link to a read-only page of its text, never the text itself, and only to private repositories. Choose Do not share on a document to keep it out"],
              ["Any phase", "New versions, links and files", "Revise a document and the old version is kept. Add links, screenshots and PDFs on the Spec tab. Each version records which AI tool and model wrote it"],
              ["Roll-out and Completed", "Outcome review and learning", "The roll-out plan is the checklist; at the outcome review you compare the result with the key result written in the PRD. Claude can record the 30, 60 and 90 day numbers you state, and draft the request for them (nothing is sent)"],
            ],
          }}
        />
      </HelpSection>
    </HelpPage>
  );
}
