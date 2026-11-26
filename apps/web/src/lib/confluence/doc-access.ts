import "server-only";
import { createClient } from "@/lib/supabase/server";
import { json } from "./http";

const UUID = /^[0-9a-f-]{36}$/i;
export type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * The document a Confluence request is about, read as the signed-in person (so row-level security applies), and whether that person may publish: a Creator or
 * Admin who is not a service account (CLAUDE.md rule 3; platform staff are not workspace members, so they are refused as well).
 */
export async function loadDocForPublish(id: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: json({ error: "Sign in first." }, 401) } as const;
  if (!UUID.test(id)) return { ok: false, error: json({ error: "Document not found." }, 404) } as const;
  const { data: doc } = await supabase.from("item_documents").select("id, tenant_id, item_id, kind, title, body, version, ai_draft").eq("id", id).maybeSingle();
  if (!doc) return { ok: false, error: json({ error: "Document not found." }, 404) } as const;
  const d = doc as { id: string; tenant_id: string; item_id: string; kind: string; title: string; body: string; version: number; ai_draft: boolean };
  const { data: me } = await supabase.from("tenant_members").select("role, is_service_account").eq("tenant_id", d.tenant_id).eq("user_id", auth.user.id).maybeSingle();
  const canPublish = Boolean(me && (me.role === "creator" || me.role === "admin") && !me.is_service_account);
  return { ok: true, supabase, doc: d, canPublish, userId: auth.user.id } as const;
}

