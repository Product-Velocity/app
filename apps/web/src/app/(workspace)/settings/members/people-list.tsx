"use client";

import { useState, useTransition } from "react";
import type { SaveResult } from "./actions";
import { InviteForm } from "./forms";

export type NotInvitedPerson = { id: string; name: string; email: string | null; initiatives: number };

export type PeopleActions = {
  addPerson: (name: string, email: string) => Promise<SaveResult>;
  updatePerson: (id: string, name: string, email: string) => Promise<SaveResult>;
  removePerson: (id: string) => Promise<SaveResult>;
  linkPerson: (personId: string, userId: string) => Promise<SaveResult>;
};

/**
 * People named on initiatives (Product Manager, Engineering Manager and so on) who are not members yet (issue #691). They count in
 * reports by name; nothing is sent to them. An admin invites them here when ready: the invitation goes through the same review step as any
 * other (nothing is sent until it is confirmed), and when they join with that email everything that names them stays.
 */
export function PeopleNotInvited({ people, members, workspaceName, emailEnabled, actions }: {
  people: NotInvitedPerson[]; members: { user_id: string; email: string }[]; workspaceName: string; emailEnabled: boolean; actions: PeopleActions;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, startTransition] = useTransition();
  const [open, setOpen] = useState<{ id: string; what: "invite" | "edit" | "link" } | null>(null);

  const run = (job: () => Promise<SaveResult>, done: string, after?: () => void) =>
    startTransition(async () => {
      const r = await job();
      setMessage(r.ok ? { tone: "ok", text: done } : { tone: "error", text: r.error });
      if (r.ok) after?.();
    });

  return (
    <section className="stack" aria-labelledby="not-invited-h" style={{ marginTop: 28 }}>
      <h2 id="not-invited-h">Not invited yet</h2>
      <p className="muted">
        People your team named as Product Manager, Engineering Manager, Designer, Analyst or Business Manager before they had an account. They show in reports and
        filters by name. Nothing is sent to them until you invite them here; when they join with the same email, everything that names them stays.
      </p>
      <form className="row-form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) run(() => actions.addPerson(name, email), `Added ${name.trim()}. Nothing was sent.`, () => { setName(""); setEmail(""); }); }}>
        <div className="field">
          <label htmlFor="person-name">Name</label>
          <input id="person-name" value={name} maxLength={120} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="person-email">Email (optional)</label>
          <input id="person-email" type="email" value={email} maxLength={254} autoComplete="off" onChange={(e) => setEmail(e.target.value)} />
        </div>
        <button className="btn" type="submit" disabled={busy || !name.trim()}>Add person</button>
      </form>
      {message && <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "error" : "notice"}>{message.text}</p>}
      {people.length === 0 ? <p className="muted">Nobody is waiting to be invited.</p> : (
        <table className="table members-table">
          <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Status</th><th scope="col">Named on</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {people.map((p) => (
              <PersonRow key={p.id} p={p} members={members} workspaceName={workspaceName} emailEnabled={emailEnabled} actions={actions} busy={busy}
                open={open?.id === p.id ? open.what : null} setOpen={(what) => setOpen(what ? { id: p.id, what } : null)} run={run} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function PersonRow({ p, members, workspaceName, emailEnabled, actions, busy, open, setOpen, run }: {
  p: NotInvitedPerson; members: { user_id: string; email: string }[]; workspaceName: string; emailEnabled: boolean; actions: PeopleActions; busy: boolean;
  open: "invite" | "edit" | "link" | null; setOpen: (what: "invite" | "edit" | "link" | null) => void;
  run: (job: () => Promise<SaveResult>, done: string, after?: () => void) => void;
}) {
  const [name, setName] = useState(p.name);
  const [email, setEmail] = useState(p.email ?? "");
  const [target, setTarget] = useState("");
  return (
    <>
      <tr>
        <td><strong>{p.name}</strong></td>
        <td>{p.email ?? <span className="muted">none yet</span>}</td>
        <td><span className="status-text status-not-invited">Not invited</span></td>
        <td>{p.initiatives === 0 ? <span className="muted">no initiative</span> : `${p.initiatives} ${p.initiatives === 1 ? "initiative" : "initiatives"}`}</td>
        <td>
          <button type="button" className="btn" aria-expanded={open === "invite"} onClick={() => setOpen(open === "invite" ? null : "invite")} aria-label={`Invite ${p.name}`}>Invite…</button>{" "}
          <button type="button" className="bulk-link" aria-expanded={open === "edit"} onClick={() => setOpen(open === "edit" ? null : "edit")} aria-label={`Edit ${p.name}`}>Edit</button>{" "}
          <button type="button" className="bulk-link" aria-expanded={open === "link"} onClick={() => setOpen(open === "link" ? null : "link")} aria-label={`${p.name} joined with another email`}>Joined with another email</button>{" "}
          <button type="button" className="bulk-link" disabled={busy} aria-label={`Remove ${p.name}`}
            onClick={() => { if (window.confirm(`Remove ${p.name} from the list?${p.initiatives ? ` They are named on ${p.initiatives} ${p.initiatives === 1 ? "initiative" : "initiatives"}, which will be left without them.` : ""}`)) run(() => actions.removePerson(p.id), `Removed ${p.name}.`); }}>Remove</button>
        </td>
      </tr>
      {open === "invite" && (
        <tr><td colSpan={5}>
          <div className="card" role="region" aria-label={`Invite ${p.name}`}>
            <p className="muted">Inviting {p.name} sends nothing until you confirm in the review step. They keep everything they are named on.</p>
            <InviteForm workspaceName={workspaceName} emailEnabled={emailEnabled} defaultEmail={p.email ?? ""} personId={p.id} />
          </div>
        </td></tr>
      )}
      {open === "edit" && (
        <tr><td colSpan={5}>
          <form className="row-form" onSubmit={(e) => { e.preventDefault(); run(() => actions.updatePerson(p.id, name, email), `Saved ${name.trim()}.`, () => setOpen(null)); }}>
            <div className="field"><label htmlFor={`pn-${p.id}`}>Name</label><input id={`pn-${p.id}`} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><label htmlFor={`pe-${p.id}`}>Email</label><input id={`pe-${p.id}`} type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} /></div>
            <button className="btn btn-primary" type="submit" disabled={busy || !name.trim()}>Save</button>
            <button className="btn" type="button" onClick={() => setOpen(null)}>Cancel</button>
          </form>
        </td></tr>
      )}
      {open === "link" && (
        <tr><td colSpan={5}>
          <form className="row-form" onSubmit={(e) => { e.preventDefault(); if (target) run(() => actions.linkPerson(p.id, target), `${p.name} is now that member everywhere.`, () => setOpen(null)); }}>
            <div className="field">
              <label htmlFor={`pl-${p.id}`}>{p.name} joined as</label>
              <select id={`pl-${p.id}`} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Choose a member…</option>
                {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.email}</option>)}
              </select>
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy || !target}>Link</button>
            <button className="btn" type="button" onClick={() => setOpen(null)}>Cancel</button>
            <p className="hint">Everything that names {p.name} will name this member instead, and {p.name} is removed from the list.</p>
          </form>
        </td></tr>
      )}
    </>
  );
}
