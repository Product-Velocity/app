import Link from "next/link";
import { requireWorkspace } from "@/lib/session";
import { parseBefore, SUBMISSIONS_PAGE, type DocSubmission } from "@/lib/document-submissions";
import { DocumentSubmissionsView } from "@/components/document-submissions-view";

export const metadata = { title: "Document submissions · Product Velocity" };

/** Request #230: every document saved in this account, by whom, with which AI tool and model, with a link to open it. Account admins (and platform admins inside the account) only. */
export default async function DocumentSubmissionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { supabase, active } = await requireWorkspace("/settings/audit/documents");
  if (active.role !== "admin" && !active.platform) {
    return (
      <div className="page-narrow">
        <h1>Document submissions</h1>
        <p className="muted">Only workspace admins can read the document log.</p>
      </div>
    );
  }
  const [{ data, error }, { data: tenant }] = await Promise.all([
    supabase.rpc("document_submissions", { p_tenant: active.tenantId, p_limit: SUBMISSIONS_PAGE + 1, p_before: parseBefore(sp.before) ?? null }),
    supabase.from("tenants").select("time_zone").eq("id", active.tenantId).single(),
  ]);
  const all = (data ?? []) as DocSubmission[];
  return (
    <div className="page-wide">
      <h1>Document submissions</h1>
      <p className="muted">
        Every PRD, discovery and other document saved in {active.tenantName}: who saved it, in which project and initiative, which type, when, and which AI tool and model wrote it (the model is what the assistant reported about itself).
        The text is not shown here; Open takes you to the initiative. <Link href="/settings/audit">Back to the audit log</Link>
      </p>
      {error && <p role="alert" className="notice">The document log could not be loaded. If the database was not updated yet, apply the migration document_ai_tool_model (docs/11-ENVIRONMENTS.md).</p>}
      <DocumentSubmissionsView rows={all.slice(0, SUBMISSIONS_PAGE)} basePath="/settings/audit/documents" showAccount={false} more={all.length > SUBMISSIONS_PAGE} timeZone={(tenant as { time_zone: string | null } | null)?.time_zone || "UTC"} />
    </div>
  );
}
