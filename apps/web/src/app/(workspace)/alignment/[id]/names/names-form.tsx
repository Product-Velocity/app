"use client";

import { useActionState } from "react";
import { revealNames, type NamesState } from "./actions";

export function NamesForm({ sessionId }: { sessionId: string }) {
  const [state, action, pending] = useActionState<NamesState, FormData>(revealNames, null);
  return (
    <div className="stack">
      <form action={action} className="card stack">
        <input type="hidden" name="id" value={sessionId} />
        <label>Why do you need to see the names? (5 to 300 characters, logged)
          <input name="reason" required minLength={5} maxLength={300} autoComplete="off" />
        </label>
        <div><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Opening…" : "Show names and answers"}</button></div>
        {state?.error && <p role="alert" className="error">{state.error}</p>}
      </form>
      {state?.rows && (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Participants and their answers</caption>
            <thead><tr><th scope="col">Person</th><th scope="col">Group</th><th scope="col">Voted</th><th scope="col">Answers</th></tr></thead>
            <tbody>
              {state.rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.name ? <strong>{r.name}</strong> : null} <span className={r.name ? "muted" : ""}>{r.email}</span></td>
                  <td>{r.group}</td>
                  <td>{r.voted ? "Yes" : "No"}</td>
                  <td>{r.answers.length === 0 ? <span className="muted">–</span> : r.answers.map((a) => `${a.item}: ${a.rank ? `place ${a.rank}` : a.coins != null ? `${a.coins} coins` : `impact ${a.impact}, confidence ${a.confidence}, ease ${a.ease}`}`).join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
