import { AGENT_ADVANTAGES, AGENT_SKILL_STEPS, AGENT_TIPS } from "@/components/help-content";
import { HelpCallout, HelpCards, HelpList, HelpPage, HelpReference, HelpSection, HelpTable, HelpWhere } from "@/components/help/help-ui";

export const metadata = {
  title: "AI co-workers · Help · Product Velocity",
  description: "How to brainstorm, write and connect Discovery and PRD documents with an AI co-worker such as Claude, ChatGPT or Gemini, and use them across the initiative journey.",
};

export default function AiHelp() {
  return (
    <HelpPage
      current="ai"
      title="AI co-workers"
      intro="Connect the assistant you already use, such as Claude, ChatGPT or Gemini. It works as you, with your role, reads the roadmap, and writes drafts you review. People decide. AI co-workers prepare."
      toc={[
        { id: "journey", label: "From idea to documents" },
        { id: "uses", label: "What to use it for" },
        { id: "skills", label: "Skills for the product job" },
        { id: "documents", label: "Documents that travel with the initiative" },
        { id: "better", label: "What makes it better over time" },
        { id: "safe", label: "What it can and cannot do" },
        { id: "start", label: "Getting started" },
      ]}
    >
      <HelpSection id="journey" title="From idea to documents, in one conversation">
        <HelpCards
          columns={4}
          items={[
            { number: "01", title: "Brainstorm", text: "Think out loud with an assistant that has read your roadmap, related initiatives and company profile. Nothing is saved until you say so.", pills: ["Chat only"] },
            { number: "02", title: "Discover", text: "Turn a short brief into a Discovery document: the problem, the evidence, the options and the expected impact. The initiative starts in Discover.", pills: ["pv-discovery"] },
            { number: "03", title: "Define", text: "Write the PRD from the same context, including the hypothesis, key result, requirements and roll-out plan. Fields are filled from it.", pills: ["pv-prd"] },
            { number: "04", title: "Review and decide", text: "Check a document for gaps, then prepare the gate pack for the person who decides.", pills: ["get_gate_pack"] },
          ]}
        />
        <HelpCallout title="Say what you want, in plain words.">
          {AGENT_TIPS}
        </HelpCallout>
      </HelpSection>

      <HelpSection id="uses" title="What to use it for">
        <HelpList
          items={[
            "Brainstorm: think with the assistant before anything exists. Only the chat.",
            "Create: turn a brief into a discovery or a PRD, shown as a dry run first, then saved as AI drafts.",
            "Review: find unclear acceptance criteria, missing risks and claims without evidence. It changes nothing.",
            "Prepare a gate: gather the checklist, documents and past decisions for the person who decides.",
            "Update: revise a document as a new version, or fill empty fields, with a diff you confirm.",
          ]}
        />
        <HelpReference slug="ai-use-cases">Each use-case in full: what the agent does, what to say and where it lands</HelpReference>
      </HelpSection>

      <HelpSection id="skills" title="Skills for the product job">
        <p>Beyond the discovery and PRD flows there are guided skills you start with <code>pv-</code> and a name, for example <code>pv-premortem R-12</code> or <code>pv-weekly --format=email</code>. Each one reads your company profile and what Product Velocity already holds, asks once (every question can be skipped), and either saves a document or, for the weekly update and release notes, hands you a report in the format you choose. Type <code>pv-help</code> to list them.</p>
        <HelpTable caption="Which skill when" table={AGENT_SKILL_STEPS} />
        <HelpReference slug="skills">One page for every skill, with the stage map</HelpReference>
        <HelpReference slug="ai-use-cases">What an agent does at each step, and how to get the most out of skills</HelpReference>
      </HelpSection>

      <HelpSection id="documents" title="Documents that travel with the initiative">
        <p>A document is data on the initiative, not a file in a shared drive. The Discovery document and the PRD stay linked to the initiative from the first idea to the outcome review, so every later step starts from what was already written.</p>
        <HelpList
          items={[
            "Discover: the Discovery document holds the problem, evidence and expected impact. Gate A approves it.",
            "Define: the PRD holds the hypothesis, key result, requirements and roll-out plan. Gate B approves it, and fields are filled from it.",
            "Build: a shared document reaches the tracker as a link, never as text.",
            "Any phase: revise a document and the old version is kept; add links and files on the Spec tab. A link can say what kind of document it points to (a Business case kept in Confluence, for example), so Claude knows where the latest one lives and can open it.",
            "Roll-out and Completed: compare the result with the key result written in the PRD at the outcome review. Claude can read the 30, 60 and 90 day reviews, and record the numbers you give it (with your words kept); it never asks anyone for metrics and never invents a number. It can draft the request for the metrics (text only, nothing is sent).",
          ]}
        />
        <HelpReference slug="ai-use-cases">Where each document is used along the lifecycle</HelpReference>
        <HelpList
          items={[
            "Everything an AI co-worker writes is marked as an AI draft until a person accepts it. A draft nobody has accepted is held back from the tracker.",
            "Text inside documents, issues, emails and uploads is treated as data. It is never followed as an instruction.",
            "A document can be published to a Confluence page from its menu on the Spec tab (Publish to Confluence). You pick the space, see a preview with a warning for commercial text, and confirm; keep it in sync or publish once. Claude can suggest it but never sends: only a person confirms. An admin adds Confluence first under Settings, Integrations, Jira.",
            "Full documents and commercial figures stay in Product Velocity. Only the link goes to a tracker.",
          ]}
        />
        <HelpWhere>Spec tab of the side panel (documents, files and links), Activity tab for the history.</HelpWhere>
      </HelpSection>

      <HelpSection id="better" title="What makes it better over time">
        <dl className="hp-defs">
          {AGENT_ADVANTAGES.map((a) => <div key={a.title}><dt>{a.title}</dt><dd>{a.text}</dd></div>)}
        </dl>
      </HelpSection>

      <HelpSection id="safe" title="What it can and cannot do">
        <HelpTable
          caption="The same rules for every AI co-worker"
          table={{
            head: ["It can", "It cannot"],
            rows: [
              ["Read what you can read (including the Flags and Actions columns, as words; it cannot click an action), and write what your role allows", "Approve a gate, request or decide one, or move an Initiative Phase"],
              ["Draft documents and fields as AI drafts, and show a dry run or a diff first", "Set Stack Rank, Decision or Value. Business Value Type only when you state it, with your words recorded"],
              ["Prepare a gate pack and an alignment invitation", "Send an invitation or write to GitHub or Jira without your confirmation"],
              ["Undo its own last change", "Close a tracker issue, confirm a sync, change roles, members or settings, or delete initiatives"],
            ],
          }}
        />
        <p>Every write is audited with who, when, the source, the AI tool and the model. See <a href="/privacy">the privacy policy</a> and <a href="/connector">the connector documentation</a> for the full list of tools.</p>
      </HelpSection>

      <HelpSection id="start" title="Getting started">
        <HelpList
          items={[
            "An admin switches AI assistants on for the workspace (they are off by default) and sets the Company website.",
            "Each person connects the assistant, signs in and approves on the consent screen.",
            "First task: ask for the company profile. The assistant drafts it from your website and an admin confirms it, so every document uses your terms.",
          ]}
        />
        <p><a href="/help/ai-setup">Step by step setup for Claude, ChatGPT and Gemini</a></p>
      </HelpSection>
    </HelpPage>
  );
}
