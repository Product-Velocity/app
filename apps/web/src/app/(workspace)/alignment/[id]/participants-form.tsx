"use client";

import { useActionState } from "react";
import type { Group } from "@/lib/alignment";
import { addParticipants, type PeopleState } from "../actions";

/** Paste a list from a spreadsheet (email, name, group) or a CSV. */
export function ParticipantsForm({ sessionId, groups }: { sessionId: string; groups: Group[] }) {
  const [state, action, pending] = useActionState<PeopleState, FormData>(addParticipants, null);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="id" value={sessionId} />
      <label>Paste people, one per line: email, name, group
        <textarea name="people" rows={5} placeholder={"ann@example.com, Ann, Engineering\nbob@example.com"} spellCheck={false} required />
      </label>
      <p className="muted">From a spreadsheet or a CSV file: copy the rows and paste them here. The name and the group are optional. A repeated address is merged into the person already there.</p>
      <label>Group for people without one
        <select name="default_group" defaultValue={groups[0]?.id}>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
      </label>
      <div><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Adding…" : "Add people"}</button></div>
      {state?.ok && <p role="status" className="notice">{state.ok}</p>}
      {state?.error && <p role="alert" className="error">{state.error}</p>}
      {state?.problems && state.problems.length > 0 && <ul className="muted">{state.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
    </form>
  );
}
