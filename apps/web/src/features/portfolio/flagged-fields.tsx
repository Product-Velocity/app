"use client";

import { FIELD_BY_KEY, FLAG_FIELDS, flagsOfRow, panelField } from "@pv/domain";
import { FieldRow, type FieldCtx } from "./item-fields";

/**
 * At the top of the item panel, under the lifecycle line: every flag the initiative carries, with the fields it is about so they can be set right there (a dropdown or an
 * open field, whichever the field is, through the same editor as the Overview). A flag with no field to type (a phase to move, a gate to request) says so and points to the
 * buttons above. Shown to people who can edit; nothing appears when the initiative has no flag. A field is shown once, under the first flag that names it.
 */
export function FlaggedFields({ ctx, itemId }: { ctx: FieldCtx; itemId: string }) {
  const row = ctx.controller.row(itemId);
  if (!row || !ctx.controller.canEdit) return null;
  const flags = flagsOfRow(row, ctx.controller.todayDate());
  if (flags.length === 0) return null;
  const labels = [...new Set(flags.map((f) => f.label))];
  const shown = new Set<string>();
  const cards = labels.map((label) => {
    const mine = flags.filter((f) => f.label === label);
    const keys = [...new Set(mine.flatMap((f) => FLAG_FIELDS[f.kind] ?? []))].filter((k) => {
      const def = FIELD_BY_KEY[k];
      if (!def || shown.has(k)) return false;
      const kind = panelField(def).kind;
      if (kind === "later" || kind === "readonly") return false;
      shown.add(k);
      return true;
    });
    return { label, texts: [...new Set(mine.map((f) => f.text))], keys, hasAction: mine.some((f) => f.action) };
  });
  return (
    <details className="ip-flagged" open aria-label="Flagged fields">
      <summary><strong>⚑ Needs your input</strong> <span className="muted">{labels.length} {labels.length === 1 ? "flag" : "flags"}</span></summary>
      <div className="ip-flagged-body">
        {cards.map((c) => (
          <section key={c.label} className="ip-flag" aria-label={c.label}>
            <p className="ip-flag-head"><span className="pill tone-risk chg-flag">⚑ {c.label}</span> <span className="muted">{c.texts.join(" ")}</span></p>
            {c.keys.length > 0
              ? <div className="ip-fields">{c.keys.map((k) => <FieldRow key={k} f={FIELD_BY_KEY[k]!} row={row} ctx={ctx} />)}</div>
              : <p className="pf-hint">{c.hasAction ? "Nothing to type here. Use the buttons above, or the action in the Actions column." : "Nothing to type here."}</p>}
          </section>
        ))}
      </div>
    </details>
  );
}
