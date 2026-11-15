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
      <section aria-labelledby="run-now" style={{ border: "2px solid #2270ED", borderRadius: 8, padding: "4px 16px 12px", margin: "16px 0 24px" }}>
        <h2 id="run-now">RUN THESE: J2, the Initiative level (issue #431)</h2>
        <p>
          Asked for in the Claude chat about the Initiative level (<a href="https://claude.ai/code/session_01TMdyHtyCiUPikJ63BEXjmr">open the chat</a>). Click a link, sign in to Atlassian if asked, and copy the result page back into that chat. The results show keys, counts and type names only. Run them in this order; each link is one click.
        </p>
        <ol>
          <li>
            Step 1, read only: <a href="/api/atlassian/start?mode=levels">the Initiative level and its tree</a>. <strong>Done on 2026-11-14</strong>: Initiative level found, epics from two projects. Run it again only to check another Initiative (add <code>&amp;arg=KEY</code> to the address).
          </li>
          <li>
            Step 2, WRITES, removes what it makes: <a href="/api/atlassian/start?mode=initiative&arg=RR,R8P">test across projects (an Initiative in RR, an epic in R8P)</a>. Creates one test Initiative and one test epic (label pv-spike), makes the Initiative the epic&apos;s parent, reads it back, asks the children query every 2 seconds for up to 10 seconds, then deletes both. <strong>Run on 2026-11-15</strong>: the parent was set across projects and read back correctly, but the children query found 0 right away. <strong>Run it once more</strong>: it now waits and tells us whether that was only the search index lagging.
          </li>
        </ol>
        <p>The test inside RR alone cannot run: RR has no Epic issue type, so there is nothing to create there. That is fine; the Initiative project does not need one.</p>
        <form action="/api/atlassian/start" method="get">
          <input type="hidden" name="mode" value="initiative" />
          <label>
            Other project keys (Initiative project, a comma, epic project):{" "}
            <input name="arg" defaultValue="RR,R8P" pattern="[A-Z][A-Z0-9_]{1,19},[A-Z][A-Z0-9_]{1,19}" required size={16} />
          </label>{" "}
          <button type="submit">Run the write test with these keys</button>
        </form>
      </section>
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
