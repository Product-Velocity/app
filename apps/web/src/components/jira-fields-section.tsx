import type { FieldsView } from "@/lib/atlassian/field-section";
import { STALE_DAYS, directionText } from "@/lib/atlassian/field-section";

type Props = {
  projectId: string;
  projectName: string;
  jiraKey: string;
  fields: FieldsView;
  refreshAction?: (form: FormData) => void | Promise<void>;
  saveAction?: (form: FormData) => void | Promise<void>;
  /** Open the list (after a save, or when something is mapped). */
  open: boolean;
};

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * The "Fields" section of a linked Jira project, for admins (issues #69, #70): every field of the Jira site with the mapping next to it.
 * Unmapped fields stay in the list and are ignored: nothing is read or written for them. Names are not unique on a site, so the id is always shown.
 */
export function JiraFieldsSection({ projectId, projectName, jiraKey, fields, refreshAction, saveAction, open }: Props) {
  const never = fields.refreshedAt === null;
  return (
    <details className="stack" open={open} data-testid={`fields-${projectId}`}>
      <summary>
        Fields of {jiraKey}
        {fields.rows.length > 0 ? ` (${fields.rows.length} fields, ${fields.mappedCount} mapped)` : ""}
      </summary>
      <div className="stack">
        <p className="muted">
          Map the Jira fields you want to the Product Velocity fields. Fields you leave unmapped stay in this list and are ignored: nothing is read from them or written to them.
          Commercial fields (value, confidence, customers, decisions, key results, outcomes) and statuses can never be mapped.
        </p>
        {fields.error && <p role="alert">The last read of the fields failed: {fields.error}</p>}
        <p className="muted">
          {never ? "The fields have not been read yet." : `Read ${when(fields.refreshedAt!)} from the newest ${fields.sampled} issues (the filled count is out of those).`}
          {fields.stale ? ` This is more than ${STALE_DAYS} days old; refresh it if your Jira admin changed fields.` : ""}
        </p>
        {refreshAction && (
          <form action={refreshAction}>
            <input type="hidden" name="project" value={projectId} />
            <button className="btn" type="submit" aria-label={`${never ? "Read the fields" : "Refresh the list of fields"} of ${jiraKey} from Jira`}>{never ? "Read the fields from Jira" : "Refresh the list"}</button>
          </form>
        )}
        {fields.rows.length > 0 && (
          <table className="table">
            <caption className="visually-hidden">Jira fields of {jiraKey} and where they are mapped in {projectName}</caption>
            <thead>
              <tr>
                <th scope="col">Jira field</th>
                <th scope="col">Id</th>
                <th scope="col">Kind</th>
                <th scope="col">Filled</th>
                <th scope="col">Hint</th>
                <th scope="col">Mapped to</th>
              </tr>
            </thead>
            <tbody>
              {fields.rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.name}{r.custom ? "" : <span className="muted"> (system)</span>}</th>
                  <td><code>{r.id}</code></td>
                  <td>{r.kindText}</td>
                  <td>{r.missing ? "-" : `${r.filled} of ${r.sampled}`}</td>
                  <td>{r.role ?? ""}</td>
                  <td>
                    {r.mapped && <p><strong>{r.mapped.pvLabel}</strong> ({directionText(r.mapped.direction)}){r.missing ? " · no longer in the list of fields" : ""}</p>}
                    {!r.mapped && <p className="muted">{r.targets.length > 0 ? "Not mapped: ignored" : `Not mappable: ${r.unmappableReason}`}</p>}
                    {!r.mapped && r.suggestion && <p className="muted">Suggestion: {r.suggestion.pvLabel} ({directionText(r.suggestion.direction)}). Not applied until you choose it.</p>}
                    {saveAction && (r.targets.length > 0 || r.mapped) && (
                      <form action={saveAction} className="row-form">
                        <input type="hidden" name="project" value={projectId} />
                        <input type="hidden" name="field" value={r.id} />
                        <div className="field">
                          <label htmlFor={`map-${projectId}-${r.id}`} className="visually-hidden">Map {r.name} ({r.id}) to</label>
                          <select id={`map-${projectId}-${r.id}`} name="target" defaultValue={r.mapped?.value ?? ""}>
                            <option value="">Not mapped (ignored)</option>
                            {r.targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                            {r.mapped && !r.targets.some((t) => t.value === r.mapped!.value) && <option value={r.mapped.value}>{r.mapped.pvLabel} ({directionText(r.mapped.direction)})</option>}
                          </select>
                        </div>
                        <button className="btn" type="submit" aria-label={`Save the mapping of ${r.name} (${r.id})`}>Save</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
}
