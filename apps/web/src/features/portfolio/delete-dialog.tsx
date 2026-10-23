"use client";

import { useEffect, useId, useRef } from "react";
import { deleteSummary, hasHistory, TRASH_DAYS } from "@pv/domain";
import type { PortfolioController } from "./controller";

type Props = { controller: PortfolioController; ids: string[]; onClose: () => void; onDeleted?: (deleted: number) => void };

/** Confirms a delete: how many, the first few names, what happens, and what is skipped. Nothing is lost: it goes to the Trash. */
export function DeleteDialog({ controller, ids, onClose, onDeleted }: Props) {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const rows = ids.map((id) => controller.row(id)).filter((r): r is NonNullable<ReturnType<PortfolioController["row"]>> => !!r);
  const deletable = rows.filter((r) => controller.canDelete(r.id));
  const skipped = rows.length - deletable.length;
  const summary = deleteSummary(deletable.map((r) => `${r.item_code} ${r.initiative_name}`));
  const withHistory = deletable.filter((r) => hasHistory(r)).length;
  useEffect(() => { confirmRef.current?.focus(); }, []);
  const finish = onClose;

  const confirm = () => {
    const r = controller.deleteItems(deletable.map((x) => x.id));
    finish();
    if (r.ok) onDeleted?.(r.deleted);
  };

  return (
    <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); finish(); } }}>
      <div className="dialog dialog-narrow" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {deletable.length === 0 ? (
          <>
            <h2 id={titleId}>Nothing to delete</h2>
            <p>Only the person who added an initiative, or an admin, can delete it.</p>
            <div className="dialog-actions"><button ref={confirmRef} type="button" className="btn" onClick={finish}>Close</button></div>
          </>
        ) : (
          <>
            <h2 id={titleId}>{summary.title}</h2>
            <ul className="delete-list">
              {summary.names.map((n) => <li key={n}>{n}</li>)}
              {summary.more > 0 && <li className="muted">and {summary.more} more</li>}
            </ul>
            <p>
              {deletable.length === 1 ? "It moves" : "They move"} to the Trash and {deletable.length === 1 ? "leaves" : "leave"} the grid, the Gantt, the cards and the reports.
              You can restore {deletable.length === 1 ? "it" : "them"} for {TRASH_DAYS} days, at the same rank, or press Ctrl+Z right away. Item codes are never reused.
            </p>
            {withHistory > 0 && (
              <p className="delete-note" role="note">
                {withHistory === 1 ? "One has" : `${withHistory} have`} a status, a decision or a GitHub link. If you only want to stop work on {withHistory === 1 ? "it" : "them"}, keep the history instead:
                Planning Status “Dropped” (arrives in phase 5) or Status “Cancelled” (set from GitHub) do that without deleting anything.
              </p>
            )}
            {skipped > 0 && <p className="delete-note" role="note">{skipped} {skipped === 1 ? "initiative was" : "initiatives were"} added by someone else, so {skipped === 1 ? "it stays" : "they stay"}: only its creator or an admin can delete {skipped === 1 ? "it" : "them"}.</p>}
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={finish}>Cancel</button>
              <button ref={confirmRef} type="button" className="btn btn-danger" onClick={confirm}>Delete {deletable.length} {deletable.length === 1 ? "initiative" : "initiatives"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
