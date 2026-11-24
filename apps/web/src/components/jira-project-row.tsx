"use client";

import { useState } from "react";
import { SelectField } from "@/components/search-list";
import { unlinkConfirmation, type ReleaseChoice } from "@/lib/atlassian/link-status";
import { initiativeLevelHint, sortTypesByLevel, typeOptionLabel } from "@/lib/atlassian/type-mapping";

export type JiraTypeOption = { id: string; name: string; hierarchyLevel: number; subtask: boolean };
export type JiraProjectChoice = { value: string; label: string; group: string; types: JiraTypeOption[]; proposal: { initiative: string | null; epic: string | null; task: string | null } };
export type JiraRowLink = { value: string; initiative: string; epic: string | null; task: string | null; /** Read only for Jira (issue #656): nothing is ever written to Jira for this project. */ readOnly?: boolean; /** Initiatives of the project: what switching to "can write" would put in front of the next Sync. */ initiatives?: number; /** When the link was last saved (jira_project_links.updated_at), shown on the row (issue #660). */ savedAt?: string | null };

/**
 * One row of the Projects table on the Jira page, the twin of GitHub's ProjectRow: delivery tracker, then (for Jira) the Jira project and which of
 * ITS issue types are an initiative, an epic and a task. One Save, no second step. The server reads the project and its types from Jira again.
 */
export function JiraProjectRow({ project, tracker, link, choices, canEdit, action, linkedInitiatives = 0 }: {
  project: { id: string; name: string };
  tracker: string | null;
  link: JiraRowLink | null;
  choices: JiraProjectChoice[];
  canEdit: boolean;
  action: (formData: FormData) => void | Promise<void>;
  /** Initiatives of this project that are linked to Jira issues: unlinking asks what to do with them. */
  linkedInitiatives?: number;
}) {
  const otherTracker = tracker !== null && tracker !== "jira";
  const [mode, setMode] = useState<"jira" | "none">(link || tracker === "jira" ? "jira" : "none");
  const [jira, setJira] = useState(link?.value ?? "");
  const chosen = choices.find((c) => c.value === jira) ?? null;
  const [initiative, setInitiative] = useState(link?.initiative ?? "");
  const [epic, setEpic] = useState(link?.epic ?? "");
  const [task, setTask] = useState(link?.task ?? "");
  // "Saved" right after a save: the page reloads with the row's new saved time, so a time within the last minute means this row was just saved
  const [justSaved] = useState(() => Boolean(link?.savedAt) && Date.now() - Date.parse(link!.savedAt!) < 60_000);
  const [access, setAccess] = useState<"write" | "read">(link?.readOnly ? "read" : "write");
  const [confirming, setConfirming] = useState(false);
  const [release, setRelease] = useState<ReleaseChoice>("keep");
  const pick = (v: string) => {
    setJira(v);
    const c = choices.find((x) => x.value === v);
    setInitiative(c?.proposal.initiative ?? "");
    setEpic(c?.proposal.epic ?? "");
    setTask(c?.proposal.task ?? "");
  };
  const types = sortTypesByLevel(chosen?.types ?? []).map((t) => ({ value: t.id, label: typeOptionLabel(t) }));
  const hint = chosen ? initiativeLevelHint(chosen.types, initiative || null) : null;
  const off = !canEdit || mode !== "jira";
  if (otherTracker) {
    return (
      <tr>
        <th scope="row">{project.name}</th>
        <td colSpan={5} className="muted">Uses {tracker === "github" ? "GitHub" : tracker} as its delivery tracker. Change it in the GitHub settings first; a project has one tracker.</td>
      </tr>
    );
  }
  const needsConfirm = mode === "none" && link !== null && linkedInitiatives > 0;
  const ready = mode === "none" ? link !== null || tracker === "jira" : Boolean(chosen && initiative && new Set([initiative, epic, task].filter(Boolean)).size === [initiative, epic, task].filter(Boolean).length);
  return (
    <>
    <tr>
      <th scope="row">{project.name}</th>
      <td><SelectField label={`Delivery tracker of ${project.name}`} value={mode} onChange={(v) => setMode(v === "jira" ? "jira" : "none")} disabled={!canEdit} options={[{ value: "none", label: "Not linked" }, { value: "jira", label: "Jira" }]} /></td>
      <td>
        <SelectField label={`Jira project for ${project.name}`} value={jira} onChange={pick} blank="Choose a Jira project…" disabled={off || choices.length === 0} options={choices.map((c) => ({ value: c.value, label: `${c.label} (${c.group})` }))} />
      </td>
      <td><SelectField label={`Initiative type in ${project.name}`} value={initiative} onChange={setInitiative} blank="Choose a type…" disabled={off || !chosen} options={types} /></td>
      <td><SelectField label={`Epic type in ${project.name}`} value={epic} onChange={setEpic} blank="None" disabled={off || !chosen} options={types} /></td>
      <td>
        <SelectField label={`Task type in ${project.name}`} value={task} onChange={setTask} blank="None" disabled={off || !chosen} options={types} />
        <SelectField label={`Access to Jira for ${project.name}`} value={access} onChange={(v) => setAccess(v === "read" ? "read" : "write")} disabled={off || !chosen} options={[{ value: "write", label: "Product Velocity can write" }, { value: "read", label: "Read only: listen to Jira" }]} />
        {canEdit && (
          <form action={action} className="row-form">
            <input type="hidden" name="project" value={project.id} />
            <input type="hidden" name="tracker" value={mode} />
            <input type="hidden" name="jira" value={jira} />
            <input type="hidden" name="initiative" value={initiative} />
            <input type="hidden" name="epic" value={epic} />
            <input type="hidden" name="task" value={task} />
            <input type="hidden" name="access" value={access} />
            {needsConfirm
              ? <button className="btn" type="button" disabled={!ready} aria-label={`Unlink ${project.name}`} aria-expanded={confirming} onClick={() => setConfirming(true)}>Unlink…</button>
              : <button className="btn" type="submit" disabled={!ready} aria-label={`Save ${project.name}`}>Save</button>}
          </form>
        )}
        {link?.savedAt && (
          <p className="muted" role="status" style={{ margin: "6px 0 0", fontSize: 12 }}>
            {justSaved && <span className="pill" style={{ marginRight: 6 }}>✓ Saved</span>}
            Last saved <time dateTime={link.savedAt} suppressHydrationWarning>{new Date(link.savedAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
          </p>
        )}
      </td>
    </tr>
    {needsConfirm && confirming && (
      <tr>
        <td colSpan={6}>
          <form action={action} className="stack" aria-label={`Unlink ${project.name} from Jira`} role="group">
            <input type="hidden" name="project" value={project.id} />
            <input type="hidden" name="tracker" value="none" />
            <fieldset className="stack">
              <legend>{project.name} has {linkedInitiatives} initiative{linkedInitiatives === 1 ? "" : "s"} linked to Jira issues. What should happen to {linkedInitiatives === 1 ? "it" : "them"}?</legend>
              <label className="radio-line"><input type="radio" name="release" value="keep" checked={release === "keep"} onChange={() => setRelease("keep")} /> Keep {linkedInitiatives === 1 ? "it" : "them"} in Product Velocity (recommended)</label>
              <label className="radio-line"><input type="radio" name="release" value="delete" checked={release === "delete"} onChange={() => setRelease("delete")} /> Delete {linkedInitiatives === 1 ? "it" : "them"} (moves to the Trash)</label>
            </fieldset>
            <ul role="status">{unlinkConfirmation(linkedInitiatives, release).consequences.map((c) => <li key={c}>{c}</li>)}</ul>
            <div>
              <button className={`btn ${unlinkConfirmation(linkedInitiatives, release).danger ? "btn-danger" : "primary"}`} type="submit">{unlinkConfirmation(linkedInitiatives, release).button}</button>{" "}
              <button className="btn" type="button" onClick={() => setConfirming(false)}>Cancel</button>
            </div>
          </form>
        </td>
      </tr>
    )}
    {mode === "jira" && chosen && access === "read" && <tr><td colSpan={6} className="muted" role="note">Read only: Product Velocity never writes to this Jira project. Initiatives are not sent, and no epic is moved. The epics you list on an initiative (Jira tab) are read with their children and their status rolls up. Their status arrives at Sync with Jira and the daily check.</td></tr>}
    {mode === "jira" && link?.readOnly && access === "write" && <tr><td colSpan={6} className="muted" role="note">Switching to &ldquo;can write&rdquo; sends nothing by itself. The next Sync with Jira will offer {link.initiatives ? `to create ${link.initiatives} initiative${link.initiatives === 1 ? "" : "s"} (the ones not in Jira yet) and ` : ""}to set the parent of the listed epics, and asks you first. Save to confirm the switch.</td></tr>}
    {hint && mode === "jira" && <tr><td colSpan={6} className="muted" role="note">{hint}</td></tr>}
    </>
  );
}
