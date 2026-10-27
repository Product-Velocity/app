"use client";

import { useState, useTransition } from "react";
import { SelectField } from "@/components/search-list";
import type { Board } from "@pv/github";
import { listBoardChoices, loadBoardFields, saveBoardLink, unlinkBoard, type BoardChoice, type BoardFieldChoice } from "./board-actions";

type ProjectBoard = { id: string; name: string; tracker: string | null; board: Board | null };

const SLOTS: { key: "priority" | "group" | "dueDate" | "size" | "status"; pv: string; what: string; blank: string; types: string[]; needs: string }[] = [
  { key: "priority", pv: "Priority", what: "Written from MoSCoW: Must becomes P0, Should P1, Could P2. Won\u2019t is not added to the board.", blank: "Don\u2019t write", types: ["SINGLE_SELECT"], needs: "single-select" },
  { key: "group", pv: "Initiative Group", what: "Written: the name of the Initiative Group.", blank: "Don\u2019t write", types: ["SINGLE_SELECT", "TEXT"], needs: "single-select or text" },
  { key: "dueDate", pv: "G2M date", what: "Written as the date of the initiative.", blank: "Don\u2019t write", types: ["DATE"], needs: "date" },
  { key: "size", pv: "Effort estimate", what: "Written as the size (XS, S, M, L, XL).", blank: "Don\u2019t write", types: ["SINGLE_SELECT"], needs: "single-select" },
  { key: "status", pv: "Delivery Status", what: "Read from the board and shown in Product Velocity. Never written.", blank: "Don\u2019t read", types: ["SINGLE_SELECT"], needs: "single-select" },
];

/** Links each PV project to an organisation GitHub Project (board) and shows how PV's fields map to the board's. */
export function BoardsCard({ projects, canEdit }: { projects: ProjectBoard[]; canEdit: boolean }) {
  return (
    <div className="card stack">
      <h2>GitHub Project boards</h2>
      <p className="muted">
        Link a project to one GitHub Project (an organisation board). Sending an initiative to GitHub then also adds it to the board and fills Priority (from MoSCoW), Initiative Group, Due date (from the G2M date) and Size (from the effort estimate). Won&rsquo;t initiatives stay in Product Velocity and are not added.
        Delivery Status is read from the board and never written. The epics and tasks under an initiative (all levels) are added to the board by a confirmed send, without field values: engineers and agents set those in GitHub.
      </p>
      {projects.map((p) => <BoardRow key={p.id} project={p} canEdit={canEdit} />)}
    </div>
  );
}

function BoardRow({ project, canEdit }: { project: ProjectBoard; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [boards, setBoards] = useState<BoardChoice[] | null>(null);
  const [boardId, setBoardId] = useState(project.board?.id ?? "");
  const [fields, setFields] = useState<BoardFieldChoice[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ error?: string; ok?: string } | null>(null);
  const [pending, start] = useTransition();
  const other = project.tracker !== null && project.tracker !== "github";

  const begin = () => start(async () => {
    setMessage(null);
    const r = await listBoardChoices();
    if ("error" in r) { setMessage({ error: r.error }); return; }
    setBoards(r.boards);
    setEditing(true);
    if (boardId) await pick(boardId);
  });
  const pick = async (id: string) => {
    setBoardId(id);
    setFields(null);
    if (!id) return;
    const r = await loadBoardFields(id);
    if (!r.ok) { setMessage({ error: r.error }); return; }
    setMessage(null);
    setFields(r.fields);
    const m = r.mapping;
    // an existing link keeps its choices; Delivery Status is new and only read, so a link saved before it existed gets the board's Status by name
    const stored = project.board?.id === id ? project.board.mapping : null;
    setChosen(Object.fromEntries(SLOTS.map((s) => [s.key, (s.key === "status" && !stored?.status ? m.status?.id : stored ? stored[s.key]?.id : m[s.key]?.id) ?? ""])));
  };
  const save = () => start(async () => {
    const r = await saveBoardLink(project.id, boardId, chosen);
    setMessage(r);
    if (r?.ok) setEditing(false);
  });
  const unlink = () => start(async () => { const r = await unlinkBoard(project.id); setMessage(r); if (r?.ok) { setEditing(false); setBoardId(""); } });

  return (
    <section className="stack" aria-label={`GitHub board of ${project.name}`}>
      <h3>{project.name}</h3>
      {other && <p className="muted">This project uses {project.tracker}, so no GitHub board applies.</p>}
      {!other && project.board && !editing && (
        <p>
          Linked to <a href={project.board.url} target="_blank" rel="noopener noreferrer">{project.board.title}</a>.{" "}
          <span className="muted">Fields: {SLOTS.filter((s) => project.board!.mapping[s.key]).map((s) => `${s.pv} → ${project.board!.mapping[s.key]!.name}`).join(", ") || "none"}.</span>
        </p>
      )}
      {!other && !project.board && !editing && <p className="muted">Not linked: initiatives are sent to the repository only.</p>}
      {!other && canEdit && !editing && (
        <div>
          <button type="button" className="btn" onClick={begin} disabled={pending}>{pending ? "Asking GitHub…" : project.board ? "Change board…" : "Link a board…"}</button>
          {project.board && <button type="button" className="btn" onClick={unlink} disabled={pending}> Unlink {project.name}</button>}
        </div>
      )}
      {editing && boards && (
        <div className="stack">
          <div className="field">
            <label htmlFor={`${project.id}-board`}><strong>GitHub Project board</strong> for {project.name}</label>
            <SelectField id={`${project.id}-board`} label={`Board for ${project.name}`} value={boardId} onChange={(v) => void pick(v)} blank="Choose a board…" options={boards.map((b) => ({ value: b.id, label: `${b.title} (#${b.number})` }))} />
          </div>
          {fields && (
            <>
              <p className="muted">We matched the board&rsquo;s fields to ours by name. For each Product Velocity field below, check which board field it uses, or choose &ldquo;Don&rsquo;t write&rdquo;.</p>
              <table className="table">
                <thead>
                  <tr><th scope="col">Product Velocity field</th><th scope="col">What happens</th><th scope="col">Board field</th></tr>
                </thead>
                <tbody>
                  {SLOTS.map((s) => {
                    const id = `${project.id}-${s.key}`;
                    // a board field already used for another row is not offered again (Status, Priority and Size are not an Initiative Group)
                    const taken = new Set(Object.entries(chosen).filter(([k, v]) => k !== s.key && v).map(([, v]) => v));
                    const usable = fields.filter((f) => s.types.includes(f.dataType) && (!taken.has(f.id) || f.id === chosen[s.key]));
                    const issueField = chosen[s.key] && project.board?.mapping.unwritable?.includes(chosen[s.key]!);
                    return (
                      <tr key={s.key}>
                        <th scope="row"><label htmlFor={id}>{s.pv}</label></th>
                        <td className="muted">{s.what}</td>
                        <td>
                          {usable.length === 0 ? (
                            <p className="muted">This board has no free {s.needs} field for this. Add one in GitHub{s.key === "group" ? " (for example “Initiative”)" : ""}, then open this form again.</p>
                          ) : (
                          <SelectField
                            id={id}
                            label={`Board field for ${s.pv}`}
                            value={chosen[s.key] ?? ""}
                            onChange={(v) => setChosen((c) => ({ ...c, [s.key]: v }))}
                            blank={s.blank}
                            options={usable.map((f) => ({ value: f.id, label: f.name }))}
                          />
                          )}
                          {issueField && <p className="muted">GitHub treats this as an issue field and does not allow it to be written through the board yet, so it is left as it is.</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="muted">Only options the board already has are used (for example P0); a missing one is reported in the send preview and nothing is created on the board.</p>
            </>
          )}
          <div>
            <button type="button" className="btn btn-primary" onClick={save} disabled={pending || !boardId || !fields}>{pending ? "Saving…" : "Save board link"}</button>
            <button type="button" className="btn" onClick={() => { setEditing(false); setMessage(null); }}> Cancel</button>
          </div>
        </div>
      )}
      {message?.ok && <p role="status" className="muted">{message.ok}</p>}
      {message?.error && <p role="alert" className="error">{message.error}</p>}
    </section>
  );
}
