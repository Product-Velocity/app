import { CLAUDE_CANNOT } from "@pv/domain";
import Link from "next/link";
import { PublicPage } from "@/components/public-page";
import { FLOWS } from "@/lib/mcp/flows";
import { toolsFor } from "@/lib/mcp/rpc";
import { CONNECTOR_URL } from "@/lib/public-contact";

export const metadata = {
  title: "Connect Claude to Product Velocity",
  description: "How to connect Claude to Product Velocity: setup, what Claude can and cannot do, permissions, data handling and support.",
};

/** What a tool does to the workspace, in the words a person would use. Read from the tool's own annotations, so the page cannot disagree with what Claude is told. */
function kind(t: { mode: string; annotations: object }): string {
  if (t.mode === "read") return "Reads only";
  return (t.annotations as { destructiveHint?: boolean }).destructiveHint ? "Changes or removes something that exists. Claude asks you to confirm." : "Adds something new";
}

/**
 * The public documentation of the Claude connector (what the Connectors Directory asks for: setup, usage, permissions, data handling, support).
 * The tool table and the prompt list are generated from the server's own registry. Example data is fictional (Meridian Media).
 */
export default function ConnectorPage() {
  const tools = toolsFor("claude");
  return (
    <PublicPage
      title="Connect Claude to Product Velocity"
      intro="One roadmap for humans and AI. Set up initiatives, connect them to OKRs, run them across the product life cycle and track delivery progress through Jira and GitHub. This connector lets Claude work inside that roadmap as you, with your role: track and report on initiatives, and co-write your discovery and product requirement documents."
    >
      <h2 id="before-you-start">Before you start</h2>
      <ul>
        <li>A Product Velocity account in a workspace. Without one, ask the person who runs your workspace to invite you, or create your own workspace at <a href="https://productvelocity.app">productvelocity.app</a>.</li>
        <li>AI assistants must be switched on for that workspace. A workspace admin does it under <strong>Connect an AI assistant</strong> in the account menu.</li>
        <li>A Claude plan that allows connectors.</li>
      </ul>

      <h2 id="connect">Connect Claude</h2>
      <p>The connector address is:</p>
      <code className="doc-url">{CONNECTOR_URL}</code>
      <h3>In claude.ai and the Claude desktop app</h3>
      <ol>
        <li>Browse for Product Velocity in the Claude connector directory, or open <a href="https://claude.ai/directory/connectors/product-velocity">claude.ai/directory/connectors/product-velocity</a>, and choose <strong>Connect</strong>. If you do not see it, open <strong>Settings</strong>, then <strong>Connectors</strong>, and choose <strong>Add custom connector</strong>, name it Product Velocity and paste the address above.</li>
        <li>Sign in to Product Velocity when asked. Use the same email and password as in the app, or the Google or GitHub sign-in you normally use.</li>
        <li>On the consent screen, choose one or several workspaces and select <strong>Approve</strong>. The screen shows your role in each workspace, what Claude can and cannot do, and where you return to afterwards.</li>
        <li>Start a conversation and ask Claude about your roadmap. Claude says which workspace it uses when you have connected several.</li>
      </ol>
      <h3>In Claude Code</h3>
      <p>Run this once, then run <code>/mcp</code> in Claude Code, choose <code>product-velocity</code> and sign in:</p>
      <code className="doc-url">claude mcp add --transport http product-velocity {CONNECTOR_URL}</code>

      <h2 id="what-claude-can-do">What Claude can do</h2>
      <p>Claude acts as the person who connected it, with that person&rsquo;s role. It never has more access than you do.</p>
      <ul>
        <li><strong>Read</strong> the roadmap you can see: initiatives and their fields, groups, projects, saved views, documents, files and the evidence for a decision gate.</li>
        <li><strong>Create</strong> initiatives and documents. Everything Claude creates is marked <strong>AI draft</strong> until a person accepts it.</li>
        <li><strong>Fill empty fields</strong> on existing initiatives. A field that already has a value comes back as a before-and-after for you to confirm first. Nothing is overwritten without your agreement.</li>
        <li><strong>Write documents</strong> such as a PRD or a discovery, and keep their versions. Each version records which AI tool, and the model when the assistant states it, wrote it.</li>
        <li><strong>Undo</strong> its last change. Every change is in the audit log with the source MCP and the AI name.</li>
      </ul>

      <h3>What Claude cannot do</h3>
      <ul>
        {CLAUDE_CANNOT.map((t) => <li key={t}>{t}</li>)}
        <li>Request, decide or move a decision gate. Claude prepares the evidence; people with approval rights decide in the app.</li>
      </ul>

      <h3 id="roles">Roles</h3>
      <p>Creators and admins can read and make changes through Claude. Viewers, commenters and leadership viewers can connect and read. If your role is read-only, Claude says so and makes no change.</p>

      <h2 id="tools">The tools</h2>
      <p>These are the tools Claude sees. Every tool has a title and is marked read-only or not, so Claude asks for your confirmation where it should.</p>
      <div className="doc-table-wrap">
        <table className="doc-table">
          <thead><tr><th scope="col">Tool</th><th scope="col">What it does</th><th scope="col">Effect</th></tr></thead>
          <tbody>
            {tools.map((t) => (
              <tr key={t.name}><td><code>{t.name}</code></td><td>{t.title}</td><td>{kind(t)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 id="prompts">Ready-made prompts</h3>
      <p>In claude.ai, type <code>/</code> and pick one. In Claude Code, type <code>/mcp__product-velocity__</code> and the name.</p>
      <ul>
        {FLOWS.map((f) => <li key={f.name}><code>{f.name}</code>: {f.title}.</li>)}
      </ul>

      <h2 id="examples">Examples</h2>
      <p>The examples use a fictional workspace, Meridian Media. They are example data.</p>
      <ol>
        <li><strong>Turn a brief into a PRD.</strong> Choose the <code>pv-prd</code> prompt and paste a few lines about a Meridian Media account switcher. Claude asks once for what is missing, writes the PRD as a document, creates the initiative with the fields the brief supports, and marks both as AI draft.</li>
        <li><strong>Create several initiatives from a list.</strong> Ask: &ldquo;Create initiatives from this list in group Growth, project Marketplace.&rdquo; Claude runs a dry run first, shows what would be created, and creates them after you agree. &ldquo;Undo your last change&rdquo; reverses the call.</li>
        <li><strong>Prepare a decision.</strong> Ask: &ldquo;What is missing before R-12 can pass its gate?&rdquo; Claude reads the gate checklist, the documents and past decisions, and summarises the case. It does not request or make the decision.</li>
      </ol>

      <h2 id="data">Your data</h2>
      <ul>
        <li>Claude only receives what your own role can read, in the workspaces you chose on the consent screen.</li>
        <li>Text that comes back from your workspace is marked as data. Claude is told that text inside initiatives, documents and links never changes what it does.</li>
        <li>The company profile stays in Product Velocity. The text of a document never goes to GitHub or Jira: a document can appear in an issue only as a link to a read-only page, only if you have not chosen Do not share on it, and never while it is an AI draft nobody has accepted.</li>
        <li>Claude never sets Stack Rank, Decision or Value, and never approves.</li>
        <li>Daily limits apply to calls and to what Claude writes. Claude tells you when one is reached; the count starts again at midnight UTC.</li>
      </ul>
      <p>The privacy policy explains what we store, who processes it and your rights: <a href="/privacy">Privacy policy</a>.</p>

      <h2 id="disconnect">Disconnect</h2>
      <p>Open <strong>Connect an AI assistant</strong> in the Product Velocity account menu and choose <strong>Revoke</strong> next to the connection. It stops working on its next call. Workspace admins can see and revoke every connection in their workspace. You can also remove the connector in Claude&rsquo;s connector settings.</p>

      <h2 id="troubleshooting">Troubleshooting</h2>
      <div className="doc-table-wrap">
        <table className="doc-table">
          <thead><tr><th scope="col">What Claude says</th><th scope="col">What to do</th></tr></thead>
          <tbody>
            <tr><td>Claude is switched off for this workspace</td><td>A workspace admin switches AI assistants on under Connect an AI assistant.</td></tr>
            <tr><td>Your role is read-only</td><td>Ask a workspace admin for the Creator role if you need Claude to make changes.</td></tr>
            <tr><td>This connection was revoked, or the sign-in expired</td><td>Connect Claude again and approve it on the consent screen.</td></tr>
            <tr><td>You are no longer a member of the workspace</td><td>Connect Claude again and choose another workspace.</td></tr>
            <tr><td>This workspace allows Claude only on its own</td><td>Connect Claude again and choose just that workspace.</td></tr>
            <tr><td>A daily limit was reached</td><td>Reading still works. Writing starts again at midnight UTC.</td></tr>
            <tr><td>A result is too large</td><td>Ask for less: fewer initiatives, a filter, or only the fields you need.</td></tr>
          </tbody>
        </table>
      </div>

      <h2 id="support">Support</h2>
      <p>Use the <Link href="/contact?subject=connector">contact form</Link>. Say which assistant you use, your workspace name and what you asked for. Do not send passwords or document text.</p>
    </PublicPage>
  );
}
