import Link from "next/link";
import { notFound } from "next/navigation";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AI_TOOL_LABEL, canEditItems, docKindLabel, formatDate } from "@pv/domain";
import { requireWorkspace } from "@/lib/session";
import { DocumentControls } from "./controls";

const STATUS: Record<string, string> = { draft: "Draft", in_review: "In review", approved: "Approved" };
type Doc = { id: string; kind: string; title: string; body: string; status: string; version: number; ai_draft: boolean; ai_tool: string | null; ai_model: string | null; updated_at: string };
type Version = { version: number; saved_at: string; saved_via: string; ai_tool: string | null; ai_model: string | null };

/** One workspace document: its text (data, never rendered as HTML), who wrote it and its versions. */
export default async function WorkspaceDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, active } = await requireWorkspace(`/documents/${id}`);
  const [d, v] = await Promise.all([
    supabase.from("workspace_documents").select("id, kind, title, body, status, version, ai_draft, ai_tool, ai_model, updated_at").eq("tenant_id", active.tenantId).eq("id", id).maybeSingle(),
    supabase.from("workspace_document_versions").select("version, saved_at, saved_via, ai_tool, ai_model").eq("tenant_id", active.tenantId).eq("document_id", id).order("version", { ascending: false }).limit(20),
  ]);
  const doc = d.data as Doc | null;
  if (!doc) notFound();
  const versions = (v.data ?? []) as Version[];
  const day = (iso: string) => formatDate(iso.slice(0, 10), new Date());
  const by = (t: string | null, m: string | null) => (t ? `${AI_TOOL_LABEL[t] ?? t}${m ? ` (${m})` : ""}` : "a person");
  return (
    <div className="page-narrow">
      <p><Link href="/documents">← Documents</Link></p>
      <h1>{doc.title}</h1>
      <p className="muted">
        {docKindLabel(doc.kind)} · {STATUS[doc.status] ?? doc.status}{doc.ai_draft ? " · AI draft: a person has not accepted it yet" : ""} · version {doc.version} · updated {day(doc.updated_at)}
        {doc.ai_tool ? ` · written by ${by(doc.ai_tool, doc.ai_model)}` : ""}
      </p>
      {canEditItems(active.role) && <DocumentControls id={doc.id} status={doc.status} aiDraft={doc.ai_draft} />}
      <div className="md-preview card" data-testid="workspace-document-body">
        {doc.body.trim() ? (
          <Markdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
              a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a>,
              img: ({ alt }) => <span className="muted">[image{alt ? `: ${alt}` : ""}]</span>,
            }}
          >
            {doc.body}
          </Markdown>
        ) : <p className="muted">This document has no text yet.</p>}
      </div>
      <h2>Versions</h2>
      <ul className="list-plain">
        {versions.map((x) => (
          <li key={x.version} className="hint">Version {x.version} · {day(x.saved_at)} · {by(x.ai_tool, x.ai_model)}</li>
        ))}
      </ul>
      <p className="hint">Documents of the workspace are never sent to GitHub or Jira. To change the text, ask your AI assistant to revise it.</p>
    </div>
  );
}
