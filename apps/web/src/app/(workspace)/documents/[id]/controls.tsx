"use client";

import { useActionState } from "react";
import { deleteWorkspaceDocument, updateWorkspaceDocument, type DocState } from "./actions";

export function DocumentControls({ id, status, aiDraft }: { id: string; status: string; aiDraft: boolean }) {
  const [state, act, pending] = useActionState<DocState, FormData>(updateWorkspaceDocument, null);
  return (
    <div className="doc-controls">
      <form action={act} className="row-inline">
        <input type="hidden" name="id" value={id} />
        {aiDraft && <button type="submit" name="action" value="accept" disabled={pending} className="btn">Accept this AI draft</button>}
        {status !== "in_review" && status !== "approved" && <button type="submit" name="action" value="review" disabled={pending} className="btn">Send to review</button>}
        {status === "in_review" && <button type="submit" name="action" value="draft" disabled={pending} className="btn">Back to draft</button>}
      </form>
      <form action={deleteWorkspaceDocument} className="row-inline" onSubmit={(e) => { if (!window.confirm("Delete this document and all its versions? This cannot be undone.")) e.preventDefault(); }}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="confirm" value="yes" />
        <button type="submit" className="btn btn-danger">Delete</button>
      </form>
      <p role="status" className="hint">{state?.error ?? state?.saved ?? ""}</p>
    </div>
  );
}
