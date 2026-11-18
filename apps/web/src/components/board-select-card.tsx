import { BOARD_SELECTS, type BoardField, type BoardMapping } from "@pv/github";
import { BSEL_DIR, BSEL_FIELD, BSEL_OPT, valuesOf } from "@/lib/github/board-selects-form";

// "Initiative fields" for a GitHub project (issue #513, the twin of the Jira card): Health, Initiative Status and Initiative Phase on single-select fields of
// the project's board. A plain form post (no script). GitHub to Product Velocity is never silent: a change that comes back is a suggestion in Sync with GitHub.
const DIRECTIONS: Record<string, string> = { to_github: "Product Velocity to GitHub", two_way: "Both ways" };

export function BoardSelectCard({ projectId, projectName, boardTitle, saved, fields, fieldsError, action }: { projectId: string; projectName: string; boardTitle: string; saved: BoardMapping["selects"] | undefined; fields: BoardField[] | null; fieldsError?: string | null; action: (formData: FormData) => void | Promise<void> }) {
  const selectFields = (fields ?? []).filter((f) => f.dataType === "SINGLE_SELECT");
  return (
    <section className="stack" aria-labelledby="board-initiative-fields-title">
      <h3 id="board-initiative-fields-title">Initiative fields</h3>
      <p className="muted">
        Map Health, Initiative Status and Initiative Phase to <strong>single-select</strong> fields of the board “{boardTitle}”, and say which board option stands for each Product Velocity value.
        Product Velocity to GitHub is sent only after you confirm it in Sync with GitHub. A change made on the board comes back as a suggestion in Sync with GitHub, never silently.
        <strong> Initiative Phase only goes from Product Velocity to GitHub</strong>: it moves at the decision gates, so the board cannot change it. The board&apos;s Status field (Delivery Status) is separate and stays read-only.
      </p>
      {fields === null ? <p role="status" className="notice">{fieldsError ?? "The fields of this board could not be read just now."}</p> : selectFields.length === 0 ? <p className="muted">This board has no single-select field to use. Add one in GitHub (for example Health), then come back.</p> : null}
      <form action={action} className="stack" aria-label={`Initiative fields of ${projectName}`}>
        <input type="hidden" name="project" value={projectId} />
        {BOARD_SELECTS.map((s) => {
          const c = saved?.[s.key];
          const field = c ? selectFields.find((f) => f.id === c.field.id) : undefined;
          return (
            <fieldset key={s.key} className="stack">
              <legend>{s.label}</legend>
              <label>Board field
                <select name={BSEL_FIELD(s.key)} defaultValue={c?.field.id ?? ""} disabled={fields === null}>
                  <option value="">Not mapped</option>
                  {selectFields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  {c && fields && !field ? <option value={c.field.id}>{c.field.name} (no longer on this board)</option> : null}
                </select>
              </label>
              <label>Direction
                <select name={BSEL_DIR(s.key)} defaultValue={c?.direction ?? "to_github"}>
                  {s.directions.map((d) => <option key={d} value={d}>{DIRECTIONS[d]}</option>)}
                </select>
              </label>
              {s.directions.length === 1 && <p className="muted">Only {DIRECTIONS[s.directions[0]!]?.toLowerCase()}.</p>}
              <p className="muted">Board option for each value (leave empty to not write that value). Options are grouped by board field until the field is saved.</p>
              {valuesOf(s.key).map((v) => (
                <label key={v}>{v}
                  <select name={BSEL_OPT(s.key, v)} defaultValue={c?.options[v] ?? ""}>
                    <option value="">No board option</option>
                    {(field ? [field] : selectFields).map((f) => <optgroup key={f.id} label={f.name}>{(f.options ?? []).map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}</optgroup>)}
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
