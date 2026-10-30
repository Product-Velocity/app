import { NextResponse } from "next/server";
import { checkDocumentInput } from "@pv/domain";
import { DOC_COLS, toDoc, type DocRow } from "@/lib/documents";
import { createClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f-]{36}$/i;

async function signedIn() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  return auth.user ? supabase : null;
}

/** One document with its text; `?versions=1` adds the saved versions (number, who, when). */
export async function GET(request: Request, { params }: Ctx) {
  const { id } = await params;
  const supabase = await signedIn();
  if (!supabase) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!UUID.test(id)) return NextResponse.json({ error: "Document not found." }, { status: 404 });
  const { data } = await supabase.from("item_documents").select(DOC_COLS).eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Document not found." }, { status: 404 });
  const url = new URL(request.url);
  const wantVersion = Number(url.searchParams.get("version"));
  if (Number.isInteger(wantVersion) && wantVersion > 0) {
    const { data: v } = await supabase.from("item_document_versions").select("version, title, body, saved_at, saved_via, ai_tool, ai_model").eq("document_id", id).eq("version", wantVersion).maybeSingle();
    return v ? NextResponse.json({ version: v }) : NextResponse.json({ error: "Version not found." }, { status: 404 });
  }
  const out: Record<string, unknown> = { document: toDoc(data as DocRow, true) };
  if (url.searchParams.get("versions")) {
    const { data: vs } = await supabase.from("item_document_versions").select("version, saved_at, saved_via, ai_tool, ai_model, saved_by_name").eq("document_id", id).order("version", { ascending: false });
    out.versions = vs ?? [];
  }
  return NextResponse.json(out);
}

/**
 * Saves a document. `baseVersion` is the version the person was looking at: if somebody saved in between nothing is written and the
 * newer text comes back (409), so nobody's work is lost. `acceptDraft` clears the AI-draft flag; approval is not possible here.
 */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const supabase = await signedIn();
  if (!supabase) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!UUID.test(id)) return NextResponse.json({ error: "Document not found." }, { status: 404 });
  const input = (await request.json().catch(() => null)) as { baseVersion?: number; kind?: string; title?: string; body?: string; status?: string; acceptDraft?: boolean } | null;
  if (!input || !Number.isInteger(input.baseVersion)) return NextResponse.json({ error: "Missing the version this change is based on." }, { status: 400 });
  const c = checkDocumentInput({ kind: input.kind, title: input.title, body: input.body, status: input.status }, { requireTitle: false });
  if (!c.ok) return NextResponse.json({ error: c.error }, { status: 422 });
  const patch: Record<string, unknown> = { ...c.value };
  if (input.acceptDraft === true) patch.ai_draft = false;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  const { data, error } = await supabase.from("item_documents").update(patch).eq("id", id).eq("version", input.baseVersion!).select(DOC_COLS);
  if (error) return NextResponse.json({ error: "You do not have permission to change this document." }, { status: 403 });
  if (data?.[0]) return NextResponse.json({ document: toDoc(data[0] as DocRow, true) });
  const { data: now } = await supabase.from("item_documents").select(DOC_COLS).eq("id", id).maybeSingle();
  if (!now) return NextResponse.json({ error: "Document not found, or you cannot change it." }, { status: 404 });
  return NextResponse.json({ error: "Somebody saved a newer version while you were editing. Nothing was overwritten.", current: toDoc(now as DocRow, true) }, { status: 409 });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const supabase = await signedIn();
  if (!supabase) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!UUID.test(id)) return NextResponse.json({ error: "Document not found." }, { status: 404 });
  const { data, error } = await supabase.from("item_documents").delete().eq("id", id).select("id");
  if (error || !data?.length) return NextResponse.json({ error: "You do not have permission to remove this document." }, { status: 403 });
  return NextResponse.json({ ok: true });
}
