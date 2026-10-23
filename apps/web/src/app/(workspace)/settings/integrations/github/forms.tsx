"use client";

import { useActionState, useState } from "react";
import { SelectField } from "@/components/search-list";
import { saveProjectGithub, setRepoAccess, startConnection, type FormState } from "./actions";

export function ConnectForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(startConnection, null);
  return (
    <form action={action} className="stack">
      <div className="field">
        <label htmlFor="gh-account">GitHub organisation (or account) name</label>
        <input id="gh-account" name="account" required placeholder="acme-corp" autoComplete="off" />
      </div>
      <p className="muted">
        You will be sent to GitHub to install the Product Velocity app. If you are not an owner of that organisation, GitHub asks an owner to approve it and this page shows
        &ldquo;waiting for approval&rdquo;. The app asks for Issues (read and write) and Metadata (read).
      </p>
      <div><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Opening GitHub…" : "Connect GitHub"}</button></div>
      {state?.error && <p role="alert" className="error">{state.error}</p>}
    </form>
  );
}

const WHO = [
  { value: "either", label: "Either (per item)" },
  { value: "product", label: "Product team in the app" },
  { value: "engineering", label: "Engineering in GitHub" },
];

export function ProjectRow({ project, repos, canEdit }: { project: { id: string; name: string; default_repo: string | null; who_breaks_down: string }; repos: string[]; canEdit: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveProjectGithub, null);
  const [repo, setRepo] = useState(project.default_repo ?? "");
  const [who, setWho] = useState(project.who_breaks_down);
  return (
    <tr>
      <th scope="row">{project.name}</th>
      <td>
        <SelectField label={`Default repository for ${project.name}`} value={repo} onChange={setRepo} blank="No default repository" disabled={!canEdit} options={repos.map((r) => ({ value: r, label: r }))} />
      </td>
      <td>
        <SelectField label={`Who breaks down the work in ${project.name}`} value={who} onChange={setWho} disabled={!canEdit} options={WHO} />
      </td>
      <td>
        {canEdit && (
          <form action={action}>
            <input type="hidden" name="project_id" value={project.id} />
            <input type="hidden" name="default_repo" value={repo} />
            <input type="hidden" name="who_breaks_down" value={who} />
            <button className="btn" type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
            {state?.ok && <span role="status" className="muted"> {state.ok}</span>}
            {state?.error && <span role="alert" className="error"> {state.error}</span>}
          </form>
        )}
      </td>
    </tr>
  );
}

const ACCESS = [
  { value: "read_write", label: "Can be written to" },
  { value: "read_only", label: "Read-only: never written to" },
];

export function RepoRow({ repo, canEdit }: { repo: { id: string; full_name: string; is_private: boolean; access: string }; canEdit: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setRepoAccess, null);
  const [access, setAccess] = useState(repo.access);
  return (
    <tr>
      <th scope="row">{repo.full_name}</th>
      <td>{repo.is_private ? "Private" : "Public: anyone can read it"}</td>
      <td><SelectField label={`Access for ${repo.full_name}`} value={access} onChange={setAccess} options={ACCESS} disabled={!canEdit} /></td>
      <td>
        {canEdit && (
          <form action={action}>
            <input type="hidden" name="repo_id" value={repo.id} />
            <input type="hidden" name="access" value={access} />
            <button className="btn" type="submit" disabled={pending || access === repo.access}>{pending ? "Saving…" : "Save"}</button>
            {state?.ok && <span role="status" className="muted"> {state.ok}</span>}
            {state?.error && <span role="alert" className="error"> {state.error}</span>}
          </form>
        )}
      </td>
    </tr>
  );
}
