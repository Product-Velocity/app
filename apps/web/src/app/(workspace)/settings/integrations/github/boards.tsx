"use client";

import { useState, useTransition } from "react";
import { SelectField } from "@/components/search-list";
import type { Board } from "@pv/github";
import { listBoardChoices, loadBoardFields, saveBoardLink, unlinkBoard, type BoardChoice, type BoardFieldChoice } from "./board-actions";

type ProjectBoard = { id: string; name: string; tracker: string | null; board: Board | null };

const SLOTS: { key: "priority" | "group" | "dueDate" | "size" | "status"; label: string; types: string[]; hint: string }[] = [
  { key: "priority", label: "Priority", types: ["SINGLE_SELECT"], hint: "written from MoSCoW" },
  { key: "group", label: "Initiative Group", types: ["SINGLE_SELECT", "TEXT"], hint: "written from Initiative Group" },
  { key: "dueDate", label: "Due date", types: ["DATE"], hint: "written from the G2M date" },
  { key: "size", label: "Size", types: ["SINGLE_SELECT"], hint: "written from the effort estimate" },
  { key: "status", label: "Delivery status", types: ["SINGLE_SELECT"], hint: "read from the board, never written" },
];

/** Links each PV project to an organisation GitHub Project (board) and shows how PV's fields map to the board's. */
export function BoardsCard({ projects, canEdit }: { projects: ProjectBoard[]; canEdit: boolean }) {
  return (
    <div className="card stack">
      <h2>GitHub Project boards</h2>
      <p className="muted">
        Link a project to one GitHub Project (an organisation board). Sending an initiative to GitHub then also adds it to the board and fills Priority (from MoSCoW), Initiative Group, Due date (from the G2M date) and Size (from the effort estimate). Won&rsquo;t initiatives stay in Product Velocity and are not added.
        Delivery status is read from the board and never written. Child issues on the board stay in GitHub.
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
    setChosen(Object.fromEntries(SLOTS.map((s) => [s.key, (project.board?.id === id ? project.board.mapping[s.key]?.id : m[s.key]?.id) ?? ""])));
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
          <span className="muted">Fields: {SLOTS.filter((s) => project.board!.mapping[s.key]).map((s) => `${s.label} → ${project.board!.mapping[s.key]!.name}`).join(", ") || "none"}.</span>
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
          <SelectField label={`Board for ${project.name}`} value={boardId} onChange={(v) => void pick(v)} blank="Choose a board…" options={boards.map((b) => ({ value: b.id, label: `${b.title} (#${b.number})` }))} />
          {fields && SLOTS.map((s) => (
            <SelectField
              key={s.key}
              label={`${s.label} field (${s.hint})`}
              value={chosen[s.key] ?? ""}
              onChange={(v) => setChosen((c) => ({ ...c, [s.key]: v }))}
              blank={s.key === "status" ? "Don't read" : "Don't write"}
              options={fields.filter((f) => s.types.includes(f.dataType)).map((f) => ({ value: f.id, label: f.name }))}
            />
          ))}
          {fields && <p className="muted">MoSCoW becomes Priority: Must → P0, Should → P1, Could → P2. Won&rsquo;t is not added to the board. Only options the board already has are used; a missing option is reported in the send preview.</p>}
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
