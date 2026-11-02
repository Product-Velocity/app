import { requireWorkspace } from "@/lib/session";

// THROWAWAY page for spike J1 (#257). Admin-only; remove when the real Jira connection (#67) exists.
export default async function AtlassianSpike({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { active } = await requireWorkspace("/spikes/atlassian");
  if (active.role !== "admin") return <main style={{ padding: 24 }}>Admins only.</main>;
  const { status } = await searchParams;
  return (
    <main style={{ padding: 24, maxWidth: 960 }}>
      <h1>Atlassian spike (J1, #257)</h1>
      <p>Connects once with OAuth 2.0 (3LO) and reads your Jira site. Nothing is stored; no token is shown.</p>
      {status === "admins-only" ? <p role="alert">Only workspace admins can run this.</p> : null}
      {status === "not-configured" ? <p role="alert">The ATLASSIAN_* variables are not set on this deployment.</p> : null}
      <p>
        <a href="/api/atlassian/start">Connect Jira (read and write issues)</a>
      </p>
      <p>
        <a href="/api/atlassian/start?confluence=1">Connect Jira and Confluence</a>
      </p>
      <h2>Write test (J4)</h2>
      <p>
        Creates one Epic and one child Story in the first Jira <em>software</em> project, edits them, moves the Story through one workflow transition, reads them back and deletes both again. It never
        touches a Jira Product Discovery project. If a delete is refused, the page lists the issue to remove by hand. It also tests the refresh token.
      </p>
      <p>
        <a href="/api/atlassian/start?mode=write">Run the write test (writes to your Jira)</a>
      </p>
    </main>
  );
}
