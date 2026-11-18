import Link from "next/link";
import { PublicPage } from "@/components/public-page";
import { CONNECTOR_URL, PRIVACY_UPDATED } from "@/lib/public-contact";

export const metadata = {
  title: "Privacy policy · Product Velocity",
  description: "What Product Velocity stores, why, who processes it, how long it is kept, how AI assistants such as Claude reach it, and your rights.",
};

/**
 * The public privacy policy. Every statement here was checked against the code and the docs when it was written (17 November 2026);
 * change the text and PRIVACY_UPDATED together, and re-check the statement you change. Retention periods the product does not set yet
 * are not promised here (docs/14-GO-LIVE-CHECKLIST.md lists them). Legal review before real customers is on the go-live list.
 */
export default function PrivacyPage() {
  return (
    <PublicPage
      title="Privacy policy"
      intro={`Last updated ${PRIVACY_UPDATED}. This policy covers Product Velocity at productvelocity.app and the connector that lets AI assistants such as Claude work with it (${CONNECTOR_URL}).`}
    >
      <h2 id="who">Who we are</h2>
      <p>Product Velocity is a product management platform. We decide why and how personal data in the platform is processed, except for the content your organisation puts into its own workspace: for that, your organisation decides and we process it for you.</p>
      <p>For every privacy question, request or complaint use the <Link href="/contact?subject=privacy">contact form</Link>.</p>

      <h2 id="data">What we store</h2>
      <h3>Your account</h3>
      <p>Your email address, your name and profile choices (photo, language, time zone), how you sign in (email and password, Google or GitHub) and, if you turn it on, your two-factor authentication. Passwords are stored by our authentication provider as hashes; we never see them.</p>
      <h3>Workspace content</h3>
      <p>What you and your colleagues enter: initiatives and their fields, groups, projects, documents (such as a PRD), links, files and images, saved views, the company profile, decisions and their reasons. It can include names of customers and commercial figures if your organisation enters them. Do not enter data the platform does not need.</p>
      <h3>The audit log</h3>
      <p>Every change records who made it (or which AI assistant made it for them), when, from where (the app, the API, an AI assistant, GitHub or Jira, or the system), and the old and new value. It lets you review and undo changes.</p>
      <h3>AI assistant connections</h3>
      <p>When you connect an AI assistant we keep: the assistant&rsquo;s registered name, which workspaces you approved, when you connected it, when it was last used and how many calls it made, and daily usage counters per connection and per workspace. In the audit log we record the AI name and, when the assistant states it, the AI model.</p>
      <h3>People invited to an alignment session</h3>
      <p>If a workspace invites you to vote on priorities we store the email address used for the invitation, the group you were put in and your votes. Other participants see only anonymous results, and groups of fewer than five voters are hidden. Workspace admins can see who voted. Personal data is cleared after the retention time the workspace set for that session; the anonymous totals remain.</p>
      <h3>Connected tools</h3>
      <p>If your workspace connects GitHub, we store the connection to the GitHub App installation, repository names, and the issue and pull-request links and statuses linked to initiatives. If it connects Jira, we store the connection and its access tokens, which are encrypted, and the linked issues. Commercial fields such as value, confidence, customer names, decisions and their reasons are never sent to GitHub or Jira.</p>
      <h3>Technical data</h3>
      <p>Sign-in cookies that keep you signed in, and a cookie that remembers your last workspace. We do not use advertising or analytics cookies and we do not track you across other sites. Our hosting provider keeps standard request logs for security and operation.</p>

      <h2 id="why">Why we use it</h2>
      <ul>
        <li>To provide the service you or your organisation asked for: sign-in, workspaces, the roadmap, integrations, emails such as invitations, and AI assistant connections.</li>
        <li>To keep the service secure and accountable: the audit log, isolation between workspaces, limits on daily use, and investigating abuse.</li>
        <li>To answer you when you write to us, and to meet legal duties.</li>
      </ul>
      <p>We do not sell personal data. We do not use workspace content to train AI models. Product Velocity itself does not send your workspace content to any AI provider.</p>

      <h2 id="ai">AI assistants and the connector</h2>
      <ul>
        <li>An AI assistant gets data only after you sign in, choose the workspaces and approve on the consent screen. Workspace admins can switch AI assistants off for a workspace.</li>
        <li>The assistant acts as you, with your role, and can read only what you can read. People with a read-only role cannot make changes through it.</li>
        <li>What the assistant reads is sent to the assistant&rsquo;s provider as part of your conversation. That provider (for Claude, Anthropic) processes it under your own agreement with them and its own privacy policy, not ours. Choose what you ask an assistant to read with that in mind.</li>
        <li>You can revoke a connection at any time under Connect an AI assistant in the account menu. It stops working on its next call. Workspace admins can see and revoke every connection in their workspace.</li>
        <li>Claude cannot approve a decision gate, set Stack Rank, Decision or Value, delete initiatives or change roles, members or settings. Details are in the <a href="/connector">connector documentation</a>.</li>
      </ul>

      <h2 id="sharing">Who processes data for us</h2>
      <div className="doc-table-wrap">
        <table className="doc-table">
          <thead><tr><th scope="col">Provider</th><th scope="col">What for</th><th scope="col">Where</th></tr></thead>
          <tbody>
            <tr><td>Supabase</td><td>Database, sign-in and file storage</td><td>Our project runs in the EU (Ireland)</td></tr>
            <tr><td>Vercel</td><td>Hosting of the web app and the connector</td><td>Our functions run in Dublin, Ireland</td></tr>
            <tr><td>Resend</td><td>Sending email, such as invitations</td><td>See Resend&rsquo;s documentation</td></tr>
            <tr><td>GitHub, Atlassian (Jira)</td><td>Only if your workspace connects them</td><td>As each provider states</td></tr>
            <tr><td>Google, GitHub</td><td>Only if you choose them to sign in</td><td>As each provider states</td></tr>
          </tbody>
        </table>
      </div>
      <p>Some providers are based outside the European Economic Area or may process data there. Where that happens we rely on the safeguards the provider offers for such transfers. We share data with authorities only when the law requires it.</p>
      <p>Our staff are not members of your workspace. A platform administrator can open a workspace only by entering it for a limited time (up to eight hours), to support you or to improve the product. Entering and leaving are written to your workspace&rsquo;s audit log, which your admins can see, with the administrator&rsquo;s name and email. A platform administrator cannot approve anything, change members, roles or invitations, send emails or GitHub changes, or read integration secrets.</p>

      <h2 id="retention">How long we keep it</h2>
      <ul>
        <li>Workspace content, the audit log and AI connection records are kept for as long as the workspace exists. Deleted initiatives go to the Trash, where a workspace admin can restore or permanently delete them.</li>
        <li>Alignment participants&rsquo; personal data is cleared after the retention time the workspace chose for the session (between 1 and 120 months).</li>
        <li>When a workspace is deleted, its records are deleted from our database for good. Files stored for it are not removed automatically yet: ask us and we will remove them and confirm when they are gone. Anonymous totals of alignment sessions can remain.</li>
        <li>We keep what the law requires us to keep, for example records of a legal request.</li>
      </ul>

      <h2 id="rights">Your rights</h2>
      <p>You can ask us to give you a copy of your personal data, correct it, delete it, restrict or stop its use, or move it to another service. You can withdraw consent you gave, for example to take part in an alignment session. You can complain to the data protection authority of your country. To use any right, use the <Link href="/contact?subject=privacy">contact form</Link>. We answer within one month. For content in a workspace we may pass your request to the organisation that runs it.</p>

      <h2 id="security">Security</h2>
      <p>Every workspace is isolated from every other: the database enforces it row by row, not only the application. Data is encrypted in transit. Jira access tokens are encrypted. Two-factor authentication is available for every account. Every change is recorded and can be undone. If we learn of a breach that affects you we tell the organisation that runs your workspace without undue delay.</p>

      <h2 id="children">Children</h2>
      <p>Product Velocity is a business tool and is not meant for children.</p>

      <h2 id="changes">Changes</h2>
      <p>When we change this policy we change the date at the top. For a change that matters we tell workspace admins.</p>
    </PublicPage>
  );
}
