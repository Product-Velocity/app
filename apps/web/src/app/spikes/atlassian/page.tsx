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
      <h2>Refresh token test</h2>
      <p>The write test (J4) was retired when Sync with Jira began to write; this only tests that the refresh token rotates.</p>
      <p>
        <a href="/api/atlassian/start?mode=write">Test the refresh token (writes nothing)</a>
      </p>
      <h2>More probes (J3, J5, J6, J8)</h2>
      <p>Each link runs one probe and shows counts and status codes only (no issue text, no site address). Write probes ask for your go-ahead by being clicked, create at most one object and remove it again.</p>
      <ul>
        <li><a href="/api/atlassian/start?mode=paging">J6: page through every issue (read only; best on a site with 250+ issues)</a></li>
        <li><a href="/api/atlassian/start?mode=devinfo&arg=PLAT-1">J5: development information of one issue (read only; edit the key in the address: arg=YOUR-KEY)</a></li>
        <li><a href="/api/atlassian/start?mode=idea&arg=DISC">J8: write one Product Discovery idea (creates and deletes one; edit arg= to your discovery project key)</a></li>
        <li><a href="/api/atlassian/start?mode=webhook&arg=PLAT">J3: register, refresh and delete one webhook (adds the scope manage:jira-webhook; edit arg= to a project key)</a></li>
      </ul>
    </main>
  );
}
