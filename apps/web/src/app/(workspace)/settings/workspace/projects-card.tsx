"use client";

import { useActionState, useState } from "react";
import { deleteProject, renameProject, setProjectAlignmentDefaults, type ProjectState } from "./actions";
import { deleteWarning, nameMatches } from "@/lib/projects/manage";

// Rename and delete a project (issue #526), on Settings, Workspace. Admins only. Deleting asks for the project's name and names what will go.
export type ProjectRow = { id: string; name: string; tracker: "jira" | "github" | null; live: number; trashed: number; coinsTotal: number; coinsMax: number };

export function ProjectsCard({ projects, canEdit }: { projects: ProjectRow[]; canEdit: boolean }) {
  return (
    <section className="card stack" aria-labelledby="projects-title" id="projects">
      <h2 id="projects-title">Projects</h2>
      <p className="muted">
        Rename a project, set the coins its votes start with, or delete it with everything in it. {canEdit ? "" : "Only admins can change projects."} New projects are added on the Portfolio page.
      </p>
      {projects.length === 0 ? <p className="muted">No projects yet.</p> : (
        <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
          {projects.map((p) => <li key={p.id}><ProjectItem project={p} canEdit={canEdit} /></li>)}
        </ul>
      )}
    </section>
  );
}

function ProjectItem({ project, canEdit }: { project: ProjectRow; canEdit: boolean }) {
  const [renameState, renameAction, renaming] = useActionState<ProjectState, FormData>(renameProject, null);
  const [deleteState, deleteAction, deleting] = useActionState<ProjectState, FormData>(deleteProject, null);
  const [coinsState, coinsAction, savingCoins] = useActionState<ProjectState, FormData>(setProjectAlignmentDefaults, null);
  const [mode, setMode] = useState<"none" | "rename" | "delete">("none");
  const [typed, setTyped] = useState("");
  const warning = deleteWarning({ name: project.name, live: project.live, trashed: project.trashed, tracker: project.tracker });
  const deleted = deleteState?.ok && deleteState.project === project.id;
  if (deleted) return <p role="status" className="notice">{deleteState!.ok}</p>;
  return (
    <div className="stack">
      <div className="row-form">
        <strong>{project.name}</strong>
        <span className="muted">{project.live} initiative{project.live === 1 ? "" : "s"}{project.trashed > 0 ? `, ${project.trashed} in the Trash` : ""}{project.tracker ? ` · ${project.tracker === "jira" ? "Jira" : "GitHub"}` : ""}</span>
        {canEdit && (
          <>
            <button type="button" className="btn" aria-expanded={mode === "rename"} onClick={() => setMode(mode === "rename" ? "none" : "rename")}>Rename</button>
            <button type="button" className="btn btn-danger-quiet" aria-expanded={mode === "delete"} onClick={() => { setMode(mode === "delete" ? "none" : "delete"); setTyped(""); }}>Delete…</button>
          </>
        )}
      </div>
      {canEdit && (
        <form action={coinsAction} className="row-form" aria-label={`Coins in a vote for ${project.name}`}>
          <input type="hidden" name="project" value={project.id} />
          <div className="field">
            <label htmlFor={`ct-${project.id}`}>Coins per voter</label>
            <input id={`ct-${project.id}`} name="coins_total" type="number" min={10} max={1000} defaultValue={project.coinsTotal} required />
          </div>
          <div className="field">
            <label htmlFor={`cm-${project.id}`}>Most on one initiative</label>
            <input id={`cm-${project.id}`} name="coins_max" type="number" min={1} max={1000} defaultValue={project.coinsMax} required />
          </div>
          <button className="btn" type="submit" disabled={savingCoins}>Save coins</button>
        </form>
      )}
      {coinsState?.ok && coinsState.project === project.id && <p role="status" className="notice">{coinsState.ok}</p>}
      {coinsState?.error && coinsState.project === project.id && <p role="alert" className="error">{coinsState.error}</p>}
      {renameState?.ok && renameState.project === project.id && <p role="status" className="notice">{renameState.ok}</p>}
      {renameState?.error && renameState.project === project.id && <p role="alert" className="error">{renameState.error}</p>}
      {mode === "rename" && canEdit && (
        <form action={renameAction} className="row-form" aria-label={`Rename ${project.name}`}>
          <input type="hidden" name="project" value={project.id} />
          <div className="field">
            <label htmlFor={`rn-${project.id}`}>New name</label>
            <input id={`rn-${project.id}`} name="name" defaultValue={project.name} maxLength={120} required autoFocus />
          </div>
          <button className="btn primary" type="submit" disabled={renaming}>Save name</button>
          <button className="btn" type="button" onClick={() => setMode("none")}>Cancel</button>
        </form>
      )}
      {mode === "delete" && canEdit && (
        <form action={deleteAction} className="stack" role="group" aria-label={`Delete ${project.name}`}>
          <input type="hidden" name="project" value={project.id} />
          <ul role="status">{warning.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          <div className="field">
            <label htmlFor={`dl-${project.id}`}>To confirm, type the project name: <strong>{project.name}</strong></label>
            <input id={`dl-${project.id}`} name="confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus />
          </div>
          {deleteState?.error && deleteState.project === project.id && <p role="alert" className="error">{deleteState.error}</p>}
          <div>
            <button className="btn btn-danger" type="submit" disabled={!nameMatches(typed, project.name) || deleting}>{warning.total === 0 ? "Delete project" : `Delete project and ${warning.total} initiative${warning.total === 1 ? "" : "s"}`}</button>{" "}
            <button className="btn" type="button" onClick={() => setMode("none")}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
