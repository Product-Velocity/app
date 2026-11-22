"use client";

import { Popover } from "./popover";

export type Choice = { value: string; label: string; disabled?: boolean };

/**
 * A toolbar button that shows its current choice ("Columns: Initiative Phase"), like Filter, Columns and Group by on the grid: blue when something is
 * chosen (`active`), and a short list of options under it. `none` is the label of the "nothing chosen" entry (empty value); leave it out when one value is always chosen.
 */
export function ChoiceMenu({ name, value, choices, none, onChange, disabled = false }: {
  name: string; value: string; choices: Choice[]; none?: string; onChange: (v: string) => void; disabled?: boolean;
}) {
  const current = choices.find((c) => c.value === value);
  const shown = current?.label ?? none ?? "None";
  const all: Choice[] = none !== undefined ? [{ value: "", label: none }, ...choices] : choices;
  if (disabled) return <button type="button" className="tool-btn" disabled>{name}: <strong className="count-badge">{shown}</strong></button>;
  return (
    <Popover label={<>{name}: <strong className="count-badge">{shown}</strong></>} active={value !== ""}>
      {(close) => (
        <div role="menu" aria-label={name} className="choice-list">
          {all.map((c) => (
            <button key={c.value} type="button" role="menuitemradio" aria-checked={c.value === value} disabled={c.disabled} className="scope-item" onClick={() => { onChange(c.value); close(); }}>
              {c.label}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
