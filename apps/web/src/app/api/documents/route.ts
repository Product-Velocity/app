import { NextResponse } from "next/server";
import { checkDocumentInput, MAX_DOCS_PER_ITEM } from "@pv/domain";
import { confluenceSiteFor } from "@/lib/confluence/server";
import { DOC_COLS, toDoc, type ConfluenceView, type DocRow, type PublishRequestView, type ReadRequestView } from "@/lib/documents";
import { siteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

/** Documents of one initiative (no text). Reads go through the signed-in person's own client, so only members of the workspace see them. */
export async function GET(request: Request) {
  const item = new URL(request.url).searchParams.get("item") ?? "";
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data, error } = await supabase.from("item_documents").select(DOC_COLS).eq("item_id", item).order("created_at");
  if (error) return NextResponse.json({ error: "Documents could not be loaded." }, { status: 500 });
  const appUrl = await siteUrl();
  const rows = (data ?? []) as DocRow[];
  // the page each document was published to (the latest record), and whether this workspace can publish at all (Confluence allowed on its sign-in)
  const { data: pages } = await supabase.from("item_document_pages").select("document_id, source, sync_direction, page_url, page_title, space_key, sync_mode, published_version, published_at, unlinked_at, created_at").eq("item_id", item).order("created_at");
  const latest = new Map<string, ConfluenceView>();
  const version = new Map(rows.map((r) => [r.id, r.version]));
  for (const p of (pages ?? []) as { document_id: string; source: "pv" | "external"; sync_direction: "from_confluence" | "to_confluence" | "both"; page_url: string; page_title: string; space_key: string; sync_mode: "once" | "sync"; published_version: number; published_at: string | null; unlinked_at: string | null }[]) {
    const linked = p.unlinked_at === null;
    latest.set(p.document_id, { source: p.source, direction: p.sync_direction, pageUrl: p.page_url, pageTitle: p.page_title, spaceKey: p.space_key, syncMode: p.sync_mode, publishedVersion: p.published_version, publishedAt: p.published_at, linked, outOfDate: p.sync_direction !== "from_confluence" && linked && p.published_version < (version.get(p.document_id) ?? 0) });
  }
  const { data: reqs } = await supabase.from("item_document_publish_requests").select("document_id, space_key, parent_url, page_title, sync_mode, note, ai_model, created_via").eq("item_id", item);
  const asked = new Map<string, PublishRequestView>();
  for (const r of (reqs ?? []) as { document_id: string; space_key: string | null; parent_url: string | null; page_title: string | null; sync_mode: "once" | "sync"; note: string | null; ai_model: string | null; created_via: string }[]) {
    asked.set(r.document_id, { mode: r.sync_mode, spaceKey: r.space_key, parentUrl: r.parent_url, title: r.page_title, note: r.note, requestedBy: r.created_via === "MCP" ? "Claude" : "a person", aiModel: r.ai_model });
  }
  // requests to read a page in, or to update a document from its page (issue #721)
  const { data: readReqs } = await supabase.from("item_confluence_read_requests").select("kind, document_id, page_url, doc_kind, sync_mode, sync_direction, note, ai_model, created_via").eq("item_id", item);
  const imports: ReadRequestView[] = [];
  const refreshAsked = new Map<string, ReadRequestView>();
  for (const r of (readReqs ?? []) as { kind: "import" | "refresh"; document_id: string | null; page_url: string | null; doc_kind: string | null; sync_mode: "once" | "sync"; sync_direction: "from_confluence" | "both"; note: string | null; ai_model: string | null; created_via: string }[]) {
    const v: ReadRequestView = { kind: r.kind, pageUrl: r.page_url, docKind: r.doc_kind, mode: r.sync_mode, direction: r.sync_direction, note: r.note, requestedBy: r.created_via === "MCP" ? "Claude" : "a person", aiModel: r.ai_model };
    if (r.kind === "import") imports.push(v); else if (r.document_id) refreshAsked.set(r.document_id, v);
  }
  const { data: owner } = await supabase.from("items").select("tenant_id").eq("id", item).maybeSingle();
  const tenantId = (owner as { tenant_id?: string } | null)?.tenant_id;
  const available = tenantId ? Boolean(await confluenceSiteFor(tenantId)) : false;
  return NextResponse.json({ confluenceAvailable: available, importRequests: imports, documents: rows.map((r) => ({ ...toDoc(r, false, appUrl), confluence: latest.get(r.id) ?? null, publishRequest: asked.get(r.id) ?? null, refreshRequest: refreshAsked.get(r.id) ?? null })) });
}

/** Adds a document. The row is written as the person, so the role check, the version log and the audit log apply. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const input = (await request.json().catch(() => null)) as { item?: string; kind?: string; title?: string; body?: string } | null;
  if (!input?.item) return NextResponse.json({ error: "Choose an initiative." }, { status: 400 });
  const c = checkDocumentInput({ kind: input.kind ?? "prd", title: input.title, body: input.body ?? "" }, { requireTitle: true });
  if (!c.ok) return NextResponse.json({ error: c.error }, { status: 422 });
  const { data: item } = await supabase.from("items").select("id, tenant_id").eq("id", input.item).is("deleted_at", null).maybeSingle();
  if (!item) return NextResponse.json({ error: "This initiative no longer exists or you cannot see it." }, { status: 404 });
  const { count } = await supabase.from("item_documents").select("id", { count: "exact", head: true }).eq("item_id", input.item);
  if ((count ?? 0) >= MAX_DOCS_PER_ITEM) return NextResponse.json({ error: `An initiative can hold at most ${MAX_DOCS_PER_ITEM} documents.` }, { status: 422 });
  const { data, error } = await supabase.from("item_documents").insert({ tenant_id: item.tenant_id, item_id: item.id, kind: c.value.kind, title: c.value.title, body: c.value.body ?? "" }).select(DOC_COLS).single();
  if (error || !data) return NextResponse.json({ error: "You do not have permission to add documents here." }, { status: 403 });
  return NextResponse.json({ document: toDoc(data as DocRow, true, await siteUrl()) }, { status: 201 });
}
