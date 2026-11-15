"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { isOpenableUrl } from "@pv/domain";
import { createClient } from "@/lib/supabase/browser";
import { refreshEpics } from "@/app/(workspace)/incoming/epics";
import { needsDecision, STATE_LABEL, type EpicCoverageRow, type EpicState, type InitiativeRef } from "@/lib/atlassian/epic-coverage";

type Filter = "needs" | "all" | EpicState;
type Props = { rows: EpicCoverageRow[]; initiatives: InitiativeRef[]; projects: string[]; lastRead: string | null; canEdit: boolean; canAdmin: boolean };

/** What a person can do to an epic, in words: the state, and the initiative it belongs to when there is one. */
function StateCell({ r }: { r: EpicCoverageRow }) {
  const who = r.initiative ? <span> · {r.initiative.code} {r.initiative.name}</span> : null;
  return (
    <span className="ep-state" data-state={r.state}>
      {STATE_LABEL[r.state]}{who}
      {r.state === "initiative_not_in_pv" && r.note && <span className="muted"> ({r.note})</span>}
      {r.state === "not_linked" && r.note && <span className="muted"> {r.note}</span>}
    </span>
  );
}

function LinkCell({ r, initiatives, onDone }: { r: EpicCoverageRow; initiatives: InitiativeRef[]; onDone: (msg: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const listId = `ep-init-${r.key}`;
  const chosen = initiatives.find((i) => `${i.code} · ${i.name}` === text);
  async function link() {
    if (!chosen) return;
    setBusy(true);
    const { error } = await createClient().rpc("item_request_jira_epics", { p_item: chosen.id, p_keys: [r.key] });
    setBusy(false);
    onDone(error ? `${r.key}: ${error.message}` : `${r.key} is listed on ${chosen.code}. Run Sync with Jira on it to link the epic after the preview.`);
  }
  return (
    <span className="ep-link">
      <input list={listId} value={text} onChange={(e) => setText(e.target.value)} placeholder="Initiative…" aria-label={`Initiative for ${r.key}`} />
      <datalist id={listId}>{initiatives.map((i) => <option key={i.id} value={`${i.code} · ${i.name}`} />)}</datalist>
      <button className="btn" type="button" disabled={!chosen || busy} onClick={() => void link()}>{busy ? "Listing…" : "List on initiative"}</button>
    </span>
  );
}

export function EpicsView({ rows, initiatives, projects, lastRead, canEdit, canAdmin }: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("needs");
  const [project, setProject] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const shown = useMemo(() => rows.filter((r) =>
    (filter === "all" || (filter === "needs" ? r.state === "not_linked" || r.state === "initiative_not_in_pv" : r.state === filter)) &&
    (!project || r.project === project) && (!q.trim() || `${r.key} ${r.title}`.toLowerCase().includes(q.trim().toLowerCase())),
  ), [rows, filter, project, q]);
  const counts = useMemo(() => { const m = new Map<EpicState, number>(); for (const r of rows) m.set(r.state, (m.get(r.state) ?? 0) + 1); return m; }, [rows]);

  async function read() {
    setBusy(true);
    setNote(null);
    const r = await refreshEpics().catch((): null => null);
    setBusy(false);
    if (!r) setNote("Jira could not be read. Try again in a minute.");
    else if (!r.ok) setNote(r.error);
    else setNote(r.failed > 0 ? `Read ${r.epics} open epics from ${r.projects} ${r.projects === 1 ? "project" : "projects"}; ${r.failed} could not be read${r.truncated ? " (too many to read in one go)" : ""}.` : `Read ${r.epics} open epics from ${r.projects} ${r.projects === 1 ? "project" : "projects"}.`);
    router.refresh();
  }

  if (projects.length === 0) {
    return (
      <p className="muted">
        No Jira projects are ticked for epics yet. {canAdmin ? <>Tick them under <Link href="/settings/integrations/jira">Settings, Integrations, Jira, Projects to check for epics</Link>.</> : "A workspace admin can tick them under Settings, Integrations, Jira."}
      </p>
    );
  }
  return (
    <section className="ep-wrap" aria-label="Open epics and their initiatives">
      <div className="incoming-check">
        {canEdit && <button className="btn" type="button" disabled={busy} onClick={() => void read()}>{busy ? "Reading Jira…" : "Read epics now"}</button>}
        <span className="muted" role="status">
          {note ?? (lastRead ? `Last read ${new Date(lastRead).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}. Projects: ${projects.join(", ")}.` : `Not read yet. Projects: ${projects.join(", ")}.`)}
        </span>
      </div>
      <p className="muted">{needsDecision(rows)} of {rows.length} open epics have no initiative in Product Velocity. Reading is read only; listing an epic on an initiative changes nothing in Jira until you confirm it in Sync with Jira.</p>
      <div className="ep-filters">
        <label>Show <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="needs">Not linked ({needsDecision(rows)})</option>
          <option value="all">All ({rows.length})</option>
          {(Object.keys(STATE_LABEL) as EpicState[]).map((s) => <option key={s} value={s}>{STATE_LABEL[s]} ({counts.get(s) ?? 0})</option>)}
        </select></label>
        <label>Project <select value={project} onChange={(e) => setProject(e.target.value)}><option value="">All</option>{projects.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search key or title" aria-label="Search epics" />
      </div>
      {shown.length === 0 ? <p className="muted">{rows.length === 0 ? "No open epics were found in these projects." : "No epics match this filter."}</p> : (
        <table className="ep-table">
          <thead><tr><th>Epic</th><th>Title</th><th>Jira status</th><th>In Product Velocity</th>{canEdit && <th>Link</th>}</tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key}>
                <td>{r.url && isOpenableUrl(r.url) ? <a className="issue-key" href={r.url} target="_blank" rel="noopener noreferrer">{r.key}</a> : <span className="issue-key">{r.key}</span>}</td>
                <td>{r.title}</td>
                <td>{r.status ?? ""}</td>
                <td><StateCell r={r} /></td>
                {canEdit && <td>{r.state === "not_linked" || r.state === "initiative_not_in_pv" ? <LinkCell r={r} initiatives={initiatives} onDone={(m) => { setNote(m); router.refresh(); }} /> : null}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
