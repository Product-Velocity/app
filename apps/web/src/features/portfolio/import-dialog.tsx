"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { SelectField } from "@/components/search-list";
import { convertRows, fieldOptions, guessMapping, importableFields, MAX_IMPORT, parseTable, resolveGroup, FIELD_BY_KEY, type ImportRow } from "@pv/domain";
import type { PortfolioController } from "./controller";
import type { Lookups } from "./types";

type Props = { controller: PortfolioController; lookups: Lookups; defaultProject: string | null; initialText: string; onClose: () => void };

const PREVIEW_ROWS = 10;

/** Paste rows copied from Excel or Google Sheets, check how the columns were understood, then import. */
export function ImportDialog({ controller, lookups, defaultProject, initialText, onClose }: Props) {
  const id = useId();
  const [text, setText] = useState(initialText);
  const table = useMemo(() => parseTable(text), [text]);
  const guess = useMemo(() => guessMapping(table[0] ?? []), [table]);
  const [headerChoice, setHeaderChoice] = useState<boolean | null>(null); // null = decide from the data
  const hasHeader = headerChoice ?? guess.some((g) => g !== null);
  const [override, setOverride] = useState<Record<number, string | null>>({});
  const [project, setProject] = useState<string>(defaultProject ?? (lookups.projects.length === 1 ? lookups.projects[0]!.id : ""));
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fields = useMemo(() => importableFields(), []);
  const fieldChoices = useMemo(() => fieldOptions(fields).map((o) => ({ ...o, group: undefined })), [fields]);

  const width = table.reduce((n, r) => Math.max(n, r.length), 0);
  const body = hasHeader ? table.slice(1) : table;
  const headers = hasHeader ? table[0] ?? [] : [];
  const mapping = useMemo(
    () => Array.from({ length: width }, (_, i) => (i in override ? override[i]! : hasHeader ? guess[i] ?? null : i === 0 ? "initiative_name" : null)),
    [width, override, hasHeader, guess],
  );
  const rows = useMemo<ImportRow[]>(
    () => convertRows(body, mapping, { projects: lookups.projects, members: lookups.members, defaultProject: project || null, today: controller.todayDate() }),
    [body, mapping, lookups, project, controller],
  );
  const good = rows.filter((r) => r.errors.length === 0);
  const bad = rows.length - good.length;
  // groups in the sheet that the workspace does not have yet (an open list: they are created, never refused)
  const newGroups = useMemo(() => {
    const known = controller.groupNames();
    const out = new Map<string, { name: string; similar: string[] }>();
    for (const r of good) {
      const t = r.values.theme;
      if (typeof t !== "string") continue;
      const g = resolveGroup(t, [...known, ...[...out.values()].map((x) => x.name)]);
      if (g.kind === "new") out.set(g.name.toLowerCase(), { name: g.name, similar: g.similar });
    }
    return [...out.values()];
  }, [good, controller]);
  const shown = [...new Set(mapping.filter((m): m is string => !!m))];
  const truncated = body.filter((r) => r.some((c) => c.trim() !== "")).length > MAX_IMPORT;
  const showValue = (key: string, v: unknown) => {
    if (v === undefined || v === null) return "";
    if (key === "home_project") return lookups.projects.find((p) => p.id === v)?.name ?? "";
    if (FIELD_BY_KEY[key]?.type === "Person") return lookups.members.find((m) => m.user_id === v)?.email ?? "";
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return String(v);
  };

  useEffect(() => { textRef.current?.focus(); }, []);

  const doImport = () => {
    if (good.length === 0) return;
    const r = controller.createItems(good.map((g) => g.values as never), { via: "import", label: `Imported ${good.length} ${good.length === 1 ? "item" : "items"}` });
    if (r.ok) onClose();
  };

  return (
    <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>Import rows from a spreadsheet</h2>
        <label htmlFor={`${id}-text`} className="dialog-label">Paste the cells you copied from Excel or Google Sheets</label>
        <textarea id={`${id}-text`} ref={textRef} rows={4} value={text} onChange={(e) => { setText(e.target.value); setOverride({}); setHeaderChoice(null); }} placeholder="Copy the cells in your spreadsheet, then paste here (Ctrl+V or ⌘V)" />

        {table.length === 0 ? (
          <p className="quick-add-summary">Nothing pasted yet.</p>
        ) : (
          <>
            <div className="dialog-row">
              <label><input type="checkbox" checked={hasHeader} onChange={(e) => { setHeaderChoice(e.target.checked); setOverride({}); }} /> The first row has column names</label>
              <label>
                Project for rows that have none{" "}
                <select value={project} onChange={(e) => setProject(e.target.value)}>
                  <option value="">(choose)</option>
                  {lookups.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            </div>

            <h3>1. How the columns were read</h3>
            <table className="import-map">
              <thead><tr><th scope="col">Column in your sheet</th><th scope="col">Example</th><th scope="col">Goes into</th></tr></thead>
              <tbody>
                {mapping.map((m, i) => (
                  <tr key={i}>
                    <td>{hasHeader ? headers[i] || `Column ${i + 1}` : `Column ${i + 1}`}</td>
                    <td className="muted">{body[0]?.[i] ?? ""}</td>
                    <td>
                      <SelectField
                        label={`Field for ${hasHeader ? headers[i] || `column ${i + 1}` : `column ${i + 1}`}`} value={m ?? ""} blank="Do not import"
                        options={fieldChoices.map((o) => ({ ...o, disabled: mapping.some((x, j) => x === o.value && j !== i) }))}
                        onChange={(v) => setOverride((o) => ({ ...o, [i]: v || null }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3>2. Preview</h3>
            <p className="quick-add-summary" role="status">
              {rows.length} {rows.length === 1 ? "row" : "rows"} read: {good.length} ready{bad > 0 ? `, ${bad} with problems (these are skipped)` : ""}.
              {truncated ? ` Only the first ${MAX_IMPORT} rows are used.` : ""}
            </p>
            {newGroups.length > 0 && (
              <p className="quick-add-summary" role="status">
                New Initiative {newGroups.length === 1 ? "Group" : "Groups"} will be created: {newGroups.map((g) => g.name + (g.similar.length ? ` (looks like ${g.similar.join(", ")})` : "")).join("; ")}.
              </p>
            )}
            <div className="import-preview-wrap">
              <table className="import-preview">
                <thead>
                  <tr><th scope="col">Row</th>{shown.map((k) => <th key={k} scope="col">{FIELD_BY_KEY[k]?.name}</th>)}<th scope="col">Result</th></tr>
                </thead>
                <tbody>
                  {rows.slice(0, PREVIEW_ROWS).map((r) => (
                    <tr key={r.line}>
                      <td>{r.line}</td>
                      {shown.map((k) => <td key={k}>{showValue(k, r.values[k])}</td>)}
                      <td>{r.errors.length === 0 ? "✓ Ready" : <span className="quick-add-error">✖ {r.errors.map((e) => `${FIELD_BY_KEY[e.field]?.name}: ${e.error}`).join(" ")}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > PREVIEW_ROWS && <p className="muted">Showing the first {PREVIEW_ROWS} of {rows.length} rows.</p>}
          </>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={good.length === 0} onClick={doImport}>
            Import {good.length} {good.length === 1 ? "row" : "rows"}
          </button>
        </div>
      </div>
    </div>
  );
}
