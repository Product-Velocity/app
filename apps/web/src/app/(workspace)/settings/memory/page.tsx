import { formatDate, MEMORY_KINDS, MEMORY_STALE_DAYS, memoryIsStale, summarizeMemory, type MemoryRow } from "@pv/domain";
import { requireWorkspace } from "@/lib/session";
import { changeNote, editNote } from "./actions";

export const metadata = { title: "Memory · Product Velocity" };

const NOTICE: Record<string, string> = {
  confirmed: "Note confirmed. Assistants will treat it as checked by a person.",
  archived: "Note archived. Assistants no longer recall it; you can restore it below.",
  restored: "Note restored as a draft.",
  deleted: "Note deleted for good.",
  saved: "Note saved.",
  duplicate: "Another live note already has that title in the same place. Change the title or archive the other one.",
  invalid: "A note needs a title (120 characters at most), a text (2,000) and a source (300).",
  "not-editor": "Your role can read notes but not change them.",
  "not-admin": "Only workspace admins can delete a note for good. You can archive it instead.",
  failed: "That did not work. Please try again.",
};

type Db = { id: string; scope: MemoryRow["scope"]; group_name: string | null; item_id: string | null; kind: MemoryRow["kind"]; title: string; body: string; source: string; basis: MemoryRow["basis"]; tags: string[]; status: MemoryRow["status"]; ai_draft: boolean; version: number; verified_at: string; updated_at: string; assistant: string | null };
const ASSISTANT_LABEL: Record<string, string> = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini", other: "an AI assistant" };

/** Memory (docs/27): the notes AI assistants and people saved, with their sources. A person confirms, edits, archives or deletes; assistants only add drafts. */
export default async function MemoryPage({ searchParams }: { searchParams: Promise<{ status?: string; show?: string; kind?: string }> }) {
  const { status, show, kind } = await searchParams;
  const { supabase, active } = await requireWorkspace("/settings/memory");
  const canEdit = ["creator", "admin"].includes(active.role);
  const isAdmin = active.role === "admin";
  const { data, error } = await supabase
    .from("ai_memories")
    .select("id, scope, group_name, item_id, kind, title, body, source, basis, tags, status, ai_draft, version, verified_at, updated_at, assistant")
    .eq("tenant_id", active.tenantId)
    .order("updated_at", { ascending: false })
    .limit(1100);
  const missing = Boolean(error);
  const { data: items } = missing ? { data: [] } : await supabase.from("items").select("id, item_code").eq("tenant_id", active.tenantId).in("id", [...new Set(((data ?? []) as Db[]).map((m) => m.item_id).filter((x): x is string => Boolean(x)))]);
  const codes = new Map(((items ?? []) as { id: string; item_code: string }[]).map((i) => [i.id, i.item_code]));
  const all: MemoryRow[] = ((data ?? []) as Db[]).map((m) => ({ id: m.id, scope: m.scope, group: m.group_name, item: m.item_id ? codes.get(m.item_id) ?? null : null, kind: m.kind, title: m.title, body: m.body, source: m.source, basis: m.basis, tags: m.tags, status: m.status, ai_draft: m.ai_draft, version: m.version, verified_at: m.verified_at, updated_at: m.updated_at, assistant: m.assistant }));
  const now = new Date();
  const sum = summarizeMemory(all, now);
  const archived = all.filter((m) => m.status === "archived");
  const shown = all.filter((m) => (show === "archived" ? m.status === "archived" : m.status !== "archived") && (!kind || m.kind === kind));
  const day = (iso: string) => formatDate(iso.slice(0, 10), now);

  return (
    <div className="page-narrow">
      <h1>Memory</h1>
      {status && NOTICE[status] && <p role="status" className="notice">{NOTICE[status]}</p>}
      <p className="muted">
        Short, sourced notes that AI assistants (Claude, ChatGPT, Gemini) and people saved about {active.tenantName}: terms, partners, how your team writes, lessons from earlier initiatives.
        Any assistant you connect can recall them in later sessions. Assistants save drafts; only a person confirms. Notes are never sent to GitHub and never hold secrets, instructions, what an individual voter said, or commercial figures.
      </p>
      {missing && <p role="alert" className="notice">This deployment&rsquo;s database has not had the memory migration applied yet (<code>assistant_memory</code>), so there are no notes to show. Apply it (docs/11-ENVIRONMENTS.md).</p>}

      <p role="status">
        <strong>{sum.total} {sum.total === 1 ? "note" : "notes"}</strong>
        {sum.unconfirmed > 0 && <> · {sum.unconfirmed} not confirmed yet</>}
        {sum.stale > 0 && <> · {sum.stale} older than {MEMORY_STALE_DAYS} days (assistants check these against their source again)</>}
        {archived.length > 0 && <> · {archived.length} archived</>}
      </p>
      <nav aria-label="Filter notes" className="row-gap">
        <a href="/settings/memory">Live</a>
        {archived.length > 0 && <a href="/settings/memory?show=archived">Archived</a>}
        {MEMORY_KINDS.map((k) => <a key={k.key} href={`/settings/memory?kind=${k.key}${show === "archived" ? "&show=archived" : ""}`} aria-current={kind === k.key ? "true" : undefined}>{k.title}</a>)}
      </nav>

      {shown.length === 0 && !missing && (
        <p className="muted">
          {show === "archived" ? "No archived notes." : kind ? "No notes of that kind." : <>Nothing saved yet. Ask your assistant to <em>set up memory</em> (the <code>setup_memory</code> playbook): it proposes notes from your company profile and documents and saves the ones you pick.</>}
        </p>
      )}
      <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
        {shown.map((m) => (
          <li key={m.id} className="card stack">
            <p>
              <strong>{m.title}</strong>{" "}
              <span className="muted">
                {MEMORY_KINDS.find((k) => k.key === m.kind)?.title} · {m.scope === "workspace" ? "whole workspace" : m.scope === "group" ? `group ${m.group}` : `initiative ${m.item ?? "?"}`}
              </span>
            </p>
            <p style={{ whiteSpace: "pre-wrap" }}>{m.body}</p>
            <p className="muted">
              Source ({m.basis === "person" ? "said by a person" : m.basis === "source" ? "a page or file read" : "a document in the workspace"}): {m.source}
            </p>
            <p className="muted">
              {m.status === "confirmed" ? "Confirmed by a person" : m.ai_draft ? "AI draft, not confirmed" : "Draft, not confirmed"}
              {m.assistant ? ` · saved by ${ASSISTANT_LABEL[m.assistant] ?? m.assistant}` : ""} · updated {day(m.updated_at)} · checked against its source {day(m.verified_at)}
              {memoryIsStale(m, now) && " · out of date: assistants will check it again"}
            </p>
            {canEdit && (
              <div className="row-gap">
                {m.status === "archived" ? (
                  <form action={changeNote}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="action" value="restore" /><button className="btn" type="submit">Restore</button></form>
                ) : (
                  <>
                    {m.status !== "confirmed" && <form action={changeNote}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="action" value="confirm" /><button className="btn btn-primary" type="submit">Confirm</button></form>}
                    <form action={changeNote}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="action" value="archive" /><button className="btn" type="submit">Archive</button></form>
                  </>
                )}
                {isAdmin && <form action={changeNote}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="action" value="delete" /><button className="btn" type="submit" aria-label={`Delete ${m.title} for good`}>Delete for good</button></form>}
              </div>
            )}
            {canEdit && m.status !== "archived" && (
              <details>
                <summary>Edit</summary>
                <form action={editNote} className="stack">
                  <input type="hidden" name="id" value={m.id} />
                  <label>Title<input name="title" defaultValue={m.title} maxLength={120} required /></label>
                  <label>Text<textarea name="body" defaultValue={m.body} maxLength={2000} rows={4} required /></label>
                  <label>Source<input name="source" defaultValue={m.source} maxLength={300} required /></label>
                  <div><button className="btn btn-primary" type="submit">Save</button></div>
                </form>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
