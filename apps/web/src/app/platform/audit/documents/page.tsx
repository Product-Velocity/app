import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/session";
import { parseBefore, SUBMISSIONS_PAGE, type DocSubmission } from "@/lib/document-submissions";
import { DocumentSubmissionsView } from "@/components/document-submissions-view";

export const metadata = { title: "Document submissions (all accounts) · Product Velocity" };

/** Request #230: platform admins read the document log of every account (titles and names only). Opening a document needs entering its account first, which is logged. */
export default async function PlatformDocumentSubmissionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requirePlatformAdmin("/platform/audit/documents");
  const account = typeof sp.account === "string" && /^[0-9a-f-]{36}$/i.test(sp.account) ? sp.account : undefined;
  const [{ data, error }, { data: accounts }] = await Promise.all([
    supabase.rpc("platform_document_submissions", { p_tenant: account ?? null, p_limit: SUBMISSIONS_PAGE + 1, p_before: parseBefore(sp.before) ?? null }),
    supabase.rpc("platform_accounts", { p_limit: 500 }),
  ]);
  const all = (data ?? []) as DocSubmission[];
  const list = (accounts ?? []) as { tenant_id: string; name: string }[];
  return (
    <div className="page-wide">
      <h1>Document submissions, all accounts</h1>
      <p className="muted">
        Who saved which document, with which AI tool and model. Titles and names only. To open a document, enter its account first (All accounts, Enter): entering is logged and shown to that account&rsquo;s admins. <Link href="/platform/audit">Back to the audit log</Link>
      </p>
      <form method="get" action="/platform/audit/documents" className="filter-bar" aria-label="Filter by account">
        <label>Account
          <select name="account" defaultValue={account ?? ""}>
            <option value="">All accounts</option>
            {list.map((a) => <option key={a.tenant_id} value={a.tenant_id}>{a.name}</option>)}
          </select>
        </label>
        <button className="btn btn-primary" type="submit">Filter</button>
      </form>
      {error && <p role="alert" className="notice">The document log could not be loaded. If the database was not updated yet, apply the migration document_ai_tool_model.</p>}
      <DocumentSubmissionsView rows={all.slice(0, SUBMISSIONS_PAGE)} basePath="/platform/audit/documents" showAccount more={all.length > SUBMISSIONS_PAGE} timeZone="UTC" account={account} />
    </div>
  );
}
