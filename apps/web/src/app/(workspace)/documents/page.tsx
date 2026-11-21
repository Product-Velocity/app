import Link from "next/link";
import { docKindLabel, formatDate, summarizeProfile, type ProfileSections } from "@pv/domain";
import { requireWorkspace } from "@/lib/session";

export const metadata = { title: "Documents · Product Velocity" };

type Row = { id: string; kind: string; title: string; status: string; version: number; ai_draft: boolean; ai_tool: string | null; updated_at: string };
const STATUS: Record<string, string> = { draft: "Draft", in_review: "In review", approved: "Approved" };

/**
 * One list of what the workspace knows in writing (issue #565): the company profile and the documents that belong to the workspace itself
 * (vision, strategy, north star, weekly updates ...). Documents on an initiative stay on its Spec tab.
 */
export default async function DocumentsPage() {
  const { supabase, active } = await requireWorkspace("/documents");
  const [docs, p] = await Promise.all([
    supabase.from("workspace_documents").select("id, kind, title, status, version, ai_draft, ai_tool, updated_at").eq("tenant_id", active.tenantId).order("updated_at", { ascending: false }).limit(200),
    supabase.from("company_profiles").select("status, version, ai_draft, researched_at, confirmed_at, updated_at, sections").eq("tenant_id", active.tenantId).maybeSingle(),
  ]);
  const list = (docs.data ?? []) as Row[];
  const profile = (p.data as { status: string; version: number; ai_draft: boolean; researched_at: string | null; confirmed_at: string | null; updated_at: string; sections: ProfileSections } | null) ?? null;
  const sum = summarizeProfile(profile);
  const day = (iso: string) => formatDate(iso.slice(0, 10), new Date());
  return (
    <div className="page-narrow">
      <h1>Documents</h1>
      <p className="muted">What your workspace has in writing: the company profile and the documents that belong to the whole workspace, such as vision, strategy, the north star and weekly updates. Documents on one initiative are on its Spec tab. Ask your AI assistant to write them with the <code>pv-</code> skills (type <code>pv-help</code> to see them).</p>
      <ul className="list-plain" aria-label="Workspace documents">
        <li className="card">
          <Link href="/settings/company-profile"><strong>Company profile</strong></Link>
          <p className="hint">
            Company profile · {sum.state === "none" ? "not set up yet" : sum.state === "confirmed" ? "Confirmed" : sum.ai_draft ? "AI draft, not confirmed" : "Draft, not confirmed"}
            {profile ? ` · version ${profile.version} · updated ${day(profile.updated_at)}` : ""}
          </p>
        </li>
        {list.map((d) => (
          <li className="card" key={d.id}>
            <Link href={`/documents/${d.id}`}><strong>{d.title}</strong></Link>
            <p className="hint">
              {docKindLabel(d.kind)} · {STATUS[d.status] ?? d.status}{d.ai_draft ? " · AI draft" : ""} · version {d.version} · updated {day(d.updated_at)}
            </p>
          </li>
        ))}
      </ul>
      {list.length === 0 && <p className="muted">No workspace documents yet. Try <code>pv-vision</code>, <code>pv-strategy</code> or <code>pv-northstar</code> in your AI assistant.</p>}
    </div>
  );
}
