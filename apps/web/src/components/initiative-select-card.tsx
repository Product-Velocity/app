import { SELECT_SLOTS, type SelectFieldInfo, type SelectMap } from "@/lib/atlassian/select-map";
import { SEL_DIR, SEL_FIELD, SEL_OPT } from "@/lib/atlassian/select-map-form";

// "Initiative fields" (issue #512): Health, Initiative Status and Initiative Phase on custom select fields of the Jira issue that is the initiative. A
// plain form post (no script). Jira to Product Velocity is never silent: a change that comes back is shown in Sync with Jira for a person to accept.
const DIRECTIONS: Record<string, string> = { to_jira: "Product Velocity to Jira", two_way: "Both ways" };

export function InitiativeSelectCard({ projectId, projectName, saved, fields, fieldsError, action }: { projectId: string; projectName: string; saved: SelectMap; fields: SelectFieldInfo[] | null; fieldsError?: string | null; action: (formData: FormData) => void | Promise<void> }) {
  return (
    <section className="stack" aria-labelledby="initiative-fields-title">
      <h3 id="initiative-fields-title">Initiative fields</h3>
      <p className="muted">
        Map Health, Initiative Status and Initiative Phase to custom <strong>single-select</strong> fields on the Jira issue that is the initiative, and say which Jira option stands for each Product Velocity value.
        Product Velocity to Jira is sent only after you confirm it in Sync with Jira. A change made in Jira comes back as a suggestion in Sync with Jira, never silently.
        <strong> Initiative Phase only goes from Product Velocity to Jira</strong>: it moves at the decision gates, so Jira cannot change it. Build Status is not mapped here: it comes from the epics.
      </p>
      {fields === null ? <p role="status" className="notice">{fieldsError ?? "The fields of this Jira site could not be read just now."}</p> : fields.length === 0 ? <p className="muted">The create screen of this project&apos;s initiative issue type has no custom single-select field. Add one in Jira (for example Health) and put it on the screen, then come back.</p> : null}
      <form action={action} className="stack" aria-label={`Initiative fields of ${projectName}`}>
        <input type="hidden" name="project" value={projectId} />
        {SELECT_SLOTS.map((s) => {
          const c = saved[s.slot];
          const field = c ? fields?.find((f) => f.id === c.field) : undefined;
          const optionsFor = field ?? fields?.find((f) => f.id === c?.field);
          return (
            <fieldset key={s.slot} className="stack">
              <legend>{s.label}</legend>
              <label>Jira field
                <select name={SEL_FIELD(s.slot)} defaultValue={c?.field ?? ""} disabled={fields === null}>
                  <option value="">Not mapped</option>
                  {(fields ?? []).map((f) => <option key={f.id} value={f.id}>{f.name} ({f.id})</option>)}
                  {c && fields && !field ? <option value={c.field}>{c.field} (not on this screen any more)</option> : null}
                </select>
              </label>
              <label>Direction
                <select name={SEL_DIR(s.slot)} defaultValue={c?.direction ?? "to_jira"}>
                  {s.directions.map((d) => <option key={d} value={d}>{DIRECTIONS[d]}</option>)}
                </select>
              </label>
              {s.directions.length === 1 && <p className="muted">Only {DIRECTIONS[s.directions[0]!]?.toLowerCase()}.</p>}
              <p className="muted">Jira option for each value (leave empty to not send that value). Pick the option from the field you chose above; options are grouped by field until the field is saved.</p>
              {s.values.map((v) => (
                <label key={v}>{v}
                  <select name={SEL_OPT(s.slot, v)} defaultValue={c?.options[v] ?? ""}>
                    <option value="">No Jira option</option>
                    {(optionsFor ? [optionsFor] : (fields ?? [])).map((f) => <optgroup key={f.id} label={f.name}>{f.options.map((o) => <option key={o.id} value={o.id}>{o.value}</option>)}</optgroup>)}
                  </select>
                </label>
              ))}
            </fieldset>
          );
        })}
        <div><button className="btn primary" type="submit" disabled={fields === null}>Save initiative fields</button></div>
      </form>
    </section>
  );
}
