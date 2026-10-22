"use client";

import { useId, useMemo, useState, type RefObject } from "react";
import { parseQuickAdd, parseQuickAddList, similarItems, type QuickAddCtx, type QuickAddResult } from "@pv/domain";
import type { PortfolioController } from "./controller";
import type { Lookups } from "./types";

type Props = { controller: PortfolioController; lookups: Lookups; contextProject: string | null; inputRef: RefObject<HTMLInputElement | null> };

/** What the line will become, as chips, so a typo in a token is visible before Enter. */
function chips(r: Extract<QuickAddResult, { ok: true }>, lookups: Lookups): string[] {
  const d = r.draft;
  const project = lookups.projects.find((p) => p.id === d.home_project)?.name ?? "?";
  const person = lookups.members.find((m) => m.user_id === d.product_manager)?.email;
  return [
    `Project: ${project}${r.projectInherited ? " (from the row you are on)" : ""}`,
    person ? `Product Manager: ${person}` : null,
    d.effort ? `Effort: ${d.effort}` : null,
    d.moscow ? `MoSCoW: ${d.moscow}` : null,
  ].filter((x): x is string => !!x);
}

/** One line adds one item: type the name (and tokens), press Enter. Paste a list to add many. */
export function QuickAddBar({ controller, lookups, contextProject, inputRef }: Props) {
  const [text, setText] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [lastProject, setLastProject] = useState<string | null>(null);
  const hintId = useId();
  const ctx = useMemo<QuickAddCtx>(
    () => ({ projects: lookups.projects, members: lookups.members, defaultProject: contextProject ?? lastProject }),
    [lookups, contextProject, lastProject],
  );
  const parsed = useMemo(() => (text.trim() === "" ? null : parseQuickAdd(text, ctx)), [text, ctx]);
  const similar = useMemo(() => {
    if (!parsed?.ok) return [];
    return similarItems(parsed.draft.initiative_name, controller.rows, 3);
  }, [parsed, controller]);

  const submit = () => {
    if (!parsed) return;
    if (!parsed.ok) { setMessage({ kind: "error", text: parsed.error }); return; }
    const r = controller.createItems([parsed.draft]);
    if (!r.ok) { setMessage({ kind: "error", text: r.error }); return; }
    setLastProject(parsed.draft.home_project);
    setText("");
    setMessage(null);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (!/\r?\n/.test(pasted.trim())) return; // a single line is just text
    e.preventDefault();
    const rows = parseQuickAddList(pasted, ctx);
    const good = rows.flatMap((r) => (r.ok ? [r.draft] : []));
    const bad = rows.filter((r) => !r.ok);
    if (good.length > 0) {
      const r = controller.createItems(good);
      if (!r.ok) { setMessage({ kind: "error", text: r.error }); return; }
      setLastProject(good[good.length - 1]!.home_project);
    }
    setMessage(
      bad.length === 0
        ? { kind: "ok", text: `Added ${good.length} items. Undo with ${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘Z" : "Ctrl+Z"}.` }
        : {
            kind: "error",
            text: `${good.length > 0 ? `Added ${good.length} items. ` : ""}Skipped ${bad.length}: ${bad.slice(0, 3).map((b) => `line ${b.line} (${b.ok ? "" : b.error})`).join("; ")}${bad.length > 3 ? "; …" : ""}`,
          },
    );
  };

  return (
    <div className="quick-add">
      <label className="quick-add-label" htmlFor={`${hintId}-input`}>Add an initiative</label>
      <input
        id={`${hintId}-input`}
        ref={inputRef}
        className="quick-add-input"
        type="text"
        autoComplete="off"
        value={text}
        placeholder="Name, then #project @person M should. Press Enter to add. Paste a list to add many."
        aria-describedby={hintId}
        onChange={(e) => { setText(e.target.value); setMessage(null); }}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          else if (e.key === "Escape") { setText(""); setMessage(null); }
        }}
      />
      <div id={hintId} className="quick-add-hints" aria-live="polite">
        {message && <p className={message.kind === "error" ? "quick-add-error" : "quick-add-ok"}>{message.text}</p>}
        {!message && parsed?.ok && chips(parsed, lookups).map((c) => <span key={c} className="token-chip">{c}</span>)}
        {!message && parsed?.ok && <span className="quick-add-keys">Enter adds · paste a list to add many</span>}
        {!message && parsed && !parsed.ok && <p className="quick-add-summary">{parsed.error}</p>}
        {similar.length > 0 && (
          <p className="quick-add-similar">
            Looks similar to: {similar.map((s) => `${s.item_code} ${s.initiative_name}`).join(" · ")}. You can still add it.
          </p>
        )}
      </div>
    </div>
  );
}
