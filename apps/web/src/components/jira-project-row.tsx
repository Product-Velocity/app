"use client";

import { useState } from "react";
import { SelectField } from "@/components/search-list";

export type JiraTypeOption = { id: string; name: string };
export type JiraProjectChoice = { value: string; label: string; group: string; types: JiraTypeOption[]; proposal: { initiative: string | null; epic: string | null; task: string | null } };
export type JiraRowLink = { value: string; initiative: string; epic: string | null; task: string | null };

/**
 * One row of the Projects table on the Jira page, the twin of GitHub's ProjectRow: delivery tracker, then (for Jira) the Jira project and which of
 * ITS issue types are an initiative, an epic and a task. One Save, no second step. The server reads the project and its types from Jira again.
 */
export function JiraProjectRow({ project, tracker, link, choices, canEdit, action }: {
  project: { id: string; name: string };
  tracker: string | null;
  link: JiraRowLink | null;
  choices: JiraProjectChoice[];
  canEdit: boolean;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const otherTracker = tracker !== null && tracker !== "jira";
  const [mode, setMode] = useState<"jira" | "none">(link || tracker === "jira" ? "jira" : "none");
  const [jira, setJira] = useState(link?.value ?? "");
  const chosen = choices.find((c) => c.value === jira) ?? null;
  const [initiative, setInitiative] = useState(link?.initiative ?? "");
  const [epic, setEpic] = useState(link?.epic ?? "");
  const [task, setTask] = useState(link?.task ?? "");
  const pick = (v: string) => {
    setJira(v);
    const c = choices.find((x) => x.value === v);
    setInitiative(c?.proposal.initiative ?? "");
    setEpic(c?.proposal.epic ?? "");
    setTask(c?.proposal.task ?? "");
  };
  const types = (chosen?.types ?? []).map((t) => ({ value: t.id, label: t.name }));
  const off = !canEdit || mode !== "jira";
  if (otherTracker) {
    return (
      <tr>
        <th scope="row">{project.name}</th>
        <td colSpan={5} className="muted">Uses {tracker === "github" ? "GitHub" : tracker} as its delivery tracker. Change it in the GitHub settings first; a project has one tracker.</td>
      </tr>
    );
  }
  const ready = mode === "none" ? link !== null || tracker === "jira" : Boolean(chosen && initiative && new Set([initiative, epic, task].filter(Boolean)).size === [initiative, epic, task].filter(Boolean).length);
  return (
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
        {canEdit && (
          <form action={action} className="row-form">
            <input type="hidden" name="project" value={project.id} />
            <input type="hidden" name="tracker" value={mode} />
            <input type="hidden" name="jira" value={jira} />
            <input type="hidden" name="initiative" value={initiative} />
            <input type="hidden" name="epic" value={epic} />
            <input type="hidden" name="task" value={task} />
            <button className="btn" type="submit" disabled={!ready} aria-label={`Save ${project.name}`}>Save</button>
          </form>
        )}
      </td>
    </tr>
  );
}
