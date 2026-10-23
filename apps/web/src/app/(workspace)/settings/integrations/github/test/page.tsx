import Link from "next/link";
import { requireWorkspace } from "@/lib/session";
import { TestConsole } from "./console";

export const metadata = { title: "Test GitHub connection · Product Velocity" };

export default async function GithubTestPage() {
  const { active } = await requireWorkspace("/settings/integrations/github/test");
  return (
    <div className="page-narrow">
      <p><Link href="/settings/integrations/github">← GitHub</Link></p>
      <h1>Test GitHub connection</h1>
      <p className="muted">
        Checks this workspace&rsquo;s own connection: credentials, permissions, repositories, project defaults and webhooks. It only reads: nothing is written to GitHub
        and no secret is shown. Include the copied report when you ask for help.
      </p>
      {active.role === "admin" ? <TestConsole /> : <p className="muted">Only admins can run the test.</p>}
    </div>
  );
}
