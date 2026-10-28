import { NextResponse } from "next/server";
import { checkDocumentInput, MAX_DOCS_PER_ITEM } from "@pv/domain";
import { DOC_COLS, toDoc, type DocRow } from "@/lib/documents";
import { createClient } from "@/lib/supabase/server";

/** Documents of one initiative (no text). Reads go through the signed-in person's own client, so only members of the workspace see them. */
export async function GET(request: Request) {
  const item = new URL(request.url).searchParams.get("item") ?? "";
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data, error } = await supabase.from("item_documents").select(DOC_COLS).eq("item_id", item).order("created_at");
  if (error) return NextResponse.json({ error: "Documents could not be loaded." }, { status: 500 });
  return NextResponse.json({ documents: ((data ?? []) as DocRow[]).map((r) => toDoc(r)) });
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
  return NextResponse.json({ document: toDoc(data as DocRow, true) }, { status: 201 });
}
