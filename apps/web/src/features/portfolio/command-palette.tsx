"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { rankCommands, type Command } from "./palette";

type ItemHit = { id: string; label: string; run: () => void };
type Props = {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  /** Initiatives matching the typed text (search), shown after the commands. */
  findItems: (query: string) => ItemHit[];
};

/** ⌘K / Ctrl+K: type to find an action, a view, a scope or an initiative; Enter runs it. */
export function CommandPalette({ open, onClose, commands, findItems }: Props) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const rows = useMemo(() => {
    const cmds = rankCommands(commands, query, 10).map((c) => ({ id: c.id, label: c.label, group: c.group, hint: c.hint, run: c.run }));
    const items = query.trim().length >= 2 ? findItems(query).slice(0, 6).map((i) => ({ id: `item:${i.id}`, label: i.label, group: "Initiatives", hint: undefined as string | undefined, run: i.run })) : [];
    return [...cmds, ...items];
  }, [commands, query, findItems]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [active]);
  if (!open) return null;

  const run = (i: number) => { const r = rows[i]; if (!r) return; onClose(); setQuery(""); setActive(0); r.run(); };
  const close = () => { onClose(); setQuery(""); setActive(0); };

  return (
    <div className="palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          className="palette-input"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={rows[active] ? `${id}-${active}` : undefined}
          aria-autocomplete="list"
          aria-label="Type a command or search initiatives"
          placeholder="Type a command, a view, a scope or an initiative…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(rows.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); run(active); }
            else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
          }}
        />
        <ul id={`${id}-list`} ref={listRef} role="listbox" className="palette-list" aria-label="Results">
          {rows.length === 0 && <li className="palette-empty" role="presentation">Nothing matches “{query}”.</li>}
          {rows.map((r, i) => (
            <li key={r.id} id={`${id}-${i}`} role="option" aria-selected={i === active} className="palette-item" onMouseMove={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); run(i); }}>
              <span>{r.label}</span>
              <span className="palette-group">{r.hint ?? r.group}</span>
            </li>
          ))}
        </ul>
        <div className="palette-foot">↑ ↓ to move · Enter to run · Esc to close</div>
      </div>
    </div>
  );
}
