"use client";

import { useState } from "react";
import { isOpen } from "@pv/domain";
import { DecideDialog, MoveDialog, RequestGateDialog, type DecideRow, type DialogItem } from "./gate-dialogs";
import type { GateSource } from "./gate-source";

type Props = {
  source: GateSource;
  items: DialogItem[];
  /** Creator or admin: may request and move. */
  canEdit: boolean;
  /** Called after any change so the grid can read the new phase, gate and status. */
  onChanged: () => void;
  /** CSS class of the buttons (bulk bar buttons or panel buttons). */
  className?: string;
  /** Staff looking in: nothing is offered. */
  readOnly?: boolean;
};

/** Request gate, Decide and Move to next phase for one or many initiatives: the same three actions in the bulk bar and the item panel. */
export function GateActions({ source, items, canEdit, onChanged, className = "bulk-btn", readOnly = false }: Props) {
  const [dialog, setDialog] = useState<"request" | "move" | { decide: DecideRow[] } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const openDecide = async () => {
    setMessage(null);
    try {
      const [reqs, mine] = await Promise.all([source.loadRequests(), source.myGates()]);
      const ids = new Set(items.map((i) => i.id));
      const open = reqs.filter((r) => isOpen(r) && ids.has(r.item_id));
      if (open.length === 0) { setMessage("None of the selected initiatives has a gate request waiting."); return; }
      const mayDecide = open.filter((r) => mine.includes(r.gate));
      if (mayDecide.length === 0) { setMessage("You do not have approval rights for the gates requested here."); return; }
      if (mayDecide.length < open.length) setMessage(`${open.length - mayDecide.length} request(s) are for gates you cannot decide; they are left out.`);
      setDialog({ decide: mayDecide.map((request) => ({ request, item: items.find((i) => i.id === request.item_id) })) });
    } catch (e) { setMessage((e as Error).message); }
  };

  if (readOnly) return null;
  return (
    <>
      {canEdit && <button type="button" className={className} onClick={() => setDialog("request")}>Request gate…</button>}
      <button type="button" className={className} onClick={() => void openDecide()}>Decide…</button>
      {canEdit && <button type="button" className={className} onClick={() => setDialog("move")}>Move to next phase…</button>}
      {message && <span role="status" className="muted gate-message">{message}</span>}
      {dialog === "request" && <RequestGateDialog source={source} items={items} onClose={() => setDialog(null)} onDone={onChanged} />}
      {dialog === "move" && <MoveDialog source={source} items={items} onClose={() => setDialog(null)} onDone={onChanged} />}
      {dialog && typeof dialog === "object" && <DecideDialog source={source} rows={dialog.decide} onClose={() => setDialog(null)} onDone={onChanged} />}
    </>
  );
}
