import { INITIATIVE_STATUSES, suggestStatuses, type JiraStatusOption, type StatusMap } from "@/lib/atlassian/jira-status-map";

// "Initiative Status in Jira" of a Jira project (issue 738, decision 2026-11-27-jira-initiative-status-sync): the option that sets the Jira workflow status of the
// initiative's issue from the Initiative Status in Product Velocity. One way, after the Sync preview and confirmation. OFF unless saved. A server component with a
// plain form: the server action checks everything again.
const CATEGORY = { new: "to do", indeterminate: "in progress", done: "done" } as const;

export function InitiativeStatusSyncCard({ projectId, projectName, saved, options, error, action }: {
  projectId: string; projectName: string;
  /** The saved mapping when the option is on, null when it is off. */
  saved: StatusMap | null;
  /** The statuses Jira lists for the project's initiative issue type (null when they could not be read). */
  options: JiraStatusOption[] | null; error?: string | null;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const on = saved !== null;
  const shown: StatusMap = options ? suggestStatuses(options, saved ?? {}) : (saved ?? {});
  return (
    <section className="stack" aria-labelledby="jst-title">
      <h3 id="jst-title">Initiative Status in Jira</h3>
      <p className="muted">
        Set the Jira workflow status of an initiative&apos;s issue from its Initiative Status in Product Velocity. One way: nothing comes back from Jira. It is sent only after you confirm it
        in Sync with Jira, which shows the move for each initiative first, and it uses the workflow&apos;s own transition: when the workflow does not allow the move, the status is left as it is
        and Sync says why. It only moves the issue that is the initiative, never an epic, story or task, and it never changes Build Status, which comes from the epics. Product Velocity
        cannot create statuses or change a workflow: add them in Jira first, then read again. Completed and Cancelled should be mapped to a Done status; that closes the issue.
      </p>
      {error ? <p role="status" className="notice">{error}</p> : null}
      <form action={action} aria-label={`Initiative Status in Jira for ${projectName}`} className="stack">
        <input type="hidden" name="project" value={projectId} />
        <label>
          <input type="checkbox" name="status-sync" defaultChecked={on} disabled={options === null} /> Set the Jira status from Initiative Status for {projectName}
        </label>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Initiative Status</th><th scope="col">Jira status</th></tr></thead>
            <tbody>
              {INITIATIVE_STATUSES.map((v) => (
                <tr key={v}>
                  <th scope="row">{v}</th>
                  <td>
                    <select aria-label={`${v}: Jira status`} name={`jst:${v}`} defaultValue={shown[v] ?? ""} disabled={options === null}>
                      <option value="">No Jira status (leave Jira alone)</option>
                      {(options ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}{o.category ? ` (${CATEGORY[o.category]})` : ""}</option>)}
                    </select>
                    {!on && options && shown[v] && !saved?.[v] ? <span className="muted"> suggested: same name</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div><button className="btn primary" type="submit" disabled={options === null}>Save Initiative Status in Jira</button> <span className="muted">Switching it off removes the mapping. Nothing is written to Jira until you confirm a Sync.</span></div>
      </form>
    </section>
  );
}
