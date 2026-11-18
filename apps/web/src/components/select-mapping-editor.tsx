"use client";

import { useState } from "react";
import { completeness, createListText, looksLikeBuiltIn, suggestOptions, type EditorOption } from "@/lib/select-editor/helpers";

// The shared "Initiative fields" editor of Jira and GitHub (issue #512, #513): Health, Initiative Status and Initiative Phase mapped to select fields of the
// tracker. One compact row per field, like the MoSCoW row of the field mapping table, but the options of the chosen field appear at once, a same-name option is
// suggested, and the row says how many values are mapped and what the next Sync would do. Nothing is saved until Save; a Reset clears the row (then Save).
// A plain form post: the server action does the real checks again.

export type EditorSlot = {
  key: string;
  label: string;
  directions: { value: string; label: string }[];
  values: string[];
  saved: { field: string; direction: string; options: Record<string, string> } | null;
  /** Initiatives of this project that have a value in this field and would be written by the next Sync. */
  count: number;
};
export type EditorField = { id: string; name: string; options: EditorOption[] };

type Row = { field: string; direction: string; options: Record<string, string>; suggested: string[] };
const initial = (s: EditorSlot): Row => ({ field: s.saved?.field ?? "", direction: s.saved?.direction ?? s.directions[0]!.value, options: { ...(s.saved?.options ?? {}) }, suggested: [] });

export function SelectMappingEditor({ prefix, tracker, fieldWord, optionWord, projectId, projectName, slots, fields, fieldsError, action, readAt, readHref, phaseNote }: {
  /** Form field names: `${prefix}field:${key}`, `${prefix}dir:${key}`, `${prefix}opt:${key}:${value}`. */
  prefix: string; tracker: "Jira" | "GitHub"; fieldWord: string; optionWord: string; projectId: string; projectName: string;
  slots: EditorSlot[]; fields: EditorField[] | null; fieldsError?: string | null;
  action: (formData: FormData) => void | Promise<void>;
  /** When the fields were read (shown as text) and the link that reads them again. */
  readAt: string; readHref: string; phaseNote: string;
}) {
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(slots.map((s) => [s.key, initial(s)])));
  const [copied, setCopied] = useState(false);
  const set = (key: string, f: (r: Row) => Row) => setRows((all) => ({ ...all, [key]: f(all[key]!) }));
  const optionsOf = (fieldId: string) => fields?.find((f) => f.id === fieldId)?.options ?? [];
  const createText = createListText(slots.map((s) => ({ label: s.label, values: s.values })));

  const choose = (s: EditorSlot, fieldId: string) =>
    set(s.key, (r) => {
      const opts = optionsOf(fieldId);
      const keep = Object.fromEntries(Object.entries(r.options).filter(([, o]) => opts.some((x) => x.value === o)));
      const sug = suggestOptions(s.values.filter((v) => !keep[v]), opts.filter((o) => !Object.values(keep).includes(o.value)));
      return { ...r, field: fieldId, options: { ...keep, ...sug }, suggested: Object.keys(sug) };
    });

  return (
    <section className="stack" aria-labelledby={`${prefix}-title`}>
      <h3 id={`${prefix}-title`}>Initiative fields</h3>
      <p className="muted">
        Map Health, Initiative Status and Initiative Phase to {fieldWord} of {tracker}, and say which {optionWord} stands for each Product Velocity value.
        Product Velocity to {tracker} is sent only after you confirm it in Sync with {tracker}. A change made in {tracker} comes back as a suggestion in Sync with {tracker}, never silently. {phaseNote}
      </p>
      <p className="muted">
        {fields === null ? "" : `Read from ${tracker} ${readAt}. `}
        <a href={readHref}>Read from {tracker} now</a>
      </p>
      {fields === null ? <p role="status" className="notice">{fieldsError ?? `The fields could not be read from ${tracker} just now.`}</p> : fields.length === 0 ? <p className="muted">{fieldsError ?? `No usable ${fieldWord} were found. Add one in ${tracker}, then read again.`}</p> : null}
      <form action={action} aria-label={`Initiative fields of ${projectName}`} className="stack">
        <input type="hidden" name="project" value={projectId} />
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Product Velocity field</th><th scope="col">Direction</th><th scope="col">{tracker} field</th><th scope="col">Values</th><th scope="col"><span className="visually-hidden">Reset</span></th></tr></thead>
            <tbody>
              {slots.map((s) => {
                const r = rows[s.key]!;
                const opts = optionsOf(r.field);
                const chosen = fields?.find((f) => f.id === r.field);
                const c = completeness(s.values, r.options);
                return (
                  <tr key={s.key}>
                    <th scope="row">{s.label}</th>
                    <td>
                      <select aria-label={`${s.label}: direction`} name={`${prefix}dir:${s.key}`} value={r.direction} onChange={(e) => set(s.key, (x) => ({ ...x, direction: e.target.value }))} disabled={s.directions.length === 1}>
                        {s.directions.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                      </select>
                      {s.directions.length === 1 && <input type="hidden" name={`${prefix}dir:${s.key}`} value={r.direction} />}
                    </td>
                    <td>
                      <select aria-label={`${s.label}: ${tracker} field`} name={`${prefix}field:${s.key}`} value={r.field} onChange={(e) => choose(s, e.target.value)} disabled={fields === null}>
                        <option value="">Not mapped</option>
                        {(fields ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        {r.field && fields && !chosen ? <option value={r.field}>{r.field} (no longer available)</option> : null}
                      </select>
                      {chosen && looksLikeBuiltIn(chosen.name) && <p role="note" className="muted">“{chosen.name}” has the name of a {tracker} built-in field. Check it is the one you mean.</p>}
                    </td>
                    <td>
                      {!r.field ? <span className="muted">Choose a field to map the values.</span> : (
                        <>
                          <div className="inline-pairs">
                            {s.values.map((v) => (
                              <label key={v} className="inline-pair">
                                <span>{v}</span>
                                <select aria-label={`${s.label}: ${v}`} name={`${prefix}opt:${s.key}:${v}`} value={r.options[v] ?? ""} onChange={(e) => set(s.key, (x) => ({ ...x, options: { ...x.options, [v]: e.target.value }, suggested: x.suggested.filter((k) => k !== v) }))}>
                                  <option value="">No {optionWord}</option>
                                  {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                                {r.suggested.includes(v) && <span className="muted"> (suggested)</span>}
                              </label>
                            ))}
                          </div>
                          <p className="muted" role="status">{c.text}</p>
                          {c.mapped > 0 && <p className="muted">{s.count > 0 ? `Next Sync would write ${s.label} on ${s.count} initiative${s.count === 1 ? "" : "s"} that ${s.count === 1 ? "has" : "have"} a value.` : `No initiative of ${projectName} has a ${s.label} yet, so the next Sync would write nothing.`}</p>}
                        </>
                      )}
                    </td>
                    <td><button type="button" className="btn" onClick={() => set(s.key, () => ({ field: "", direction: s.directions[0]!.value, options: {}, suggested: [] }))}>Reset</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <details className="stack">
          <summary>Values to create in {tracker}</summary>
          <p className="muted">So the {optionWord}s match Product Velocity exactly, create one {fieldWord.replace(/s$/, "")} per row with these {optionWord}s, then read from {tracker} again.</p>
          <pre className="code">{createText}</pre>
          <div><button type="button" className="btn" onClick={() => { void navigator.clipboard?.writeText(createText).then(() => setCopied(true), () => setCopied(false)); }}>{copied ? "Copied" : "Copy the list"}</button></div>
        </details>
        <div><button className="btn primary" type="submit" disabled={fields === null}>Save initiative fields</button> <span className="muted">Reset clears a row; nothing changes until you save.</span></div>
      </form>
    </section>
  );
}
