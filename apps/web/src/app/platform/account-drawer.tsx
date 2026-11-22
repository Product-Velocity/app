"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MEMBER_STATUS_LABEL } from "@pv/domain";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/roles";
import { formatWhen } from "@/lib/audit-log";
import { LinkNotice } from "@/app/(workspace)/settings/members/forms";
import { companyHost, memberMoves, safeUrl, trackerText, isPaused, type AccountRow, type MemberRow } from "./accounts-model";
import { deleteAccount, enterAccount, setAccountLevel, setPlan, setSuspended } from "./actions";
import { cancelInvitation, changePersonStatus, inviteMember, loadAccountMembers, renewInvitation, type InviteResult } from "./members-actions";

const when = (iso: string | null, none = "—") => (iso ? formatWhen(iso, "UTC", false) : none);
const num = (n: number) => n.toLocaleString("en-GB");

/**
 * One account for the platform owner: facts, the actions (enter, pause, plan, read-only, delete) and its people (invite, renew, cancel, pause/resume/revoke).
 * Platform admins only. Pause, plan, read-only and delete are plain forms that reload the page with a notice; people actions answer in place.
 */
export function AccountDrawer({ account: a, emailEnabled, fixtureMembers, onClose }: { account: AccountRow; emailEnabled: boolean; fixtureMembers?: MemberRow[]; onClose: () => void }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const host = companyHost(a.company_url), href = safeUrl(a.company_url);
  const paused = isPaused(a);
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog acct-drawer" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} tabIndex={-1} ref={ref} data-testid="account-drawer">
        <div className="acct-drawer-head">
          <h2 id={`${id}-t`}>{a.name} {paused ? <span className="pill tone-risk">Paused</span> : <span className="pill tone-good">Active</span>}</h2>
          <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        {paused && <p className="notice" role="status">Members cannot open this account. You can still enter it. Resume it below to give them their access back.</p>}

        <h3>Details</h3>
        <dl className="plain-dl acct-facts">
          <dt>Plan</dt><dd>{a.plan}</dd>
          <dt>Created</dt><dd>{when(a.created_at)}</dd>
          <dt>Company URL</dt><dd>{href && host ? <a href={href} target="_blank" rel="noopener noreferrer">{host} ↗</a> : "—"}</dd>
          <dt>Country</dt><dd>{a.country ?? "—"}</dd>
          <dt>Owner</dt><dd>{a.owner_name ? `${a.owner_name} · ` : ""}{a.owner_email ?? "—"}</dd>
          <dt>Members</dt><dd>{num(a.member_count)} active · {num(a.invited_count)} invited · {num(a.requested_count)} waiting for approval</dd>
          <dt>Projects, line items</dt><dd>{num(a.project_count)} projects · {num(a.item_count)} line items</dd>
          <dt>Last activity</dt><dd>{when(a.last_activity, "No activity yet")}</dd>
          <dt>Last login</dt><dd>{when(a.last_login_at, "Never")}</dd>
          <dt>Claude</dt><dd>{a.claude_enabled ? "Switched on" : "Switched off"}</dd>
          <dt>AI agents</dt>
          <dd>
            {a.ai_agents.length === 0 ? "None connected" : (
              <ul className="plain-list">
                {a.ai_agents.map((g) => <li key={g.name}><strong>{g.name}</strong> · {g.connections} connection{g.connections === 1 ? "" : "s"} · {num(g.calls)} calls{g.last_used_at ? ` · last used ${when(g.last_used_at)}` : ""}</li>)}
              </ul>
            )}
          </dd>
          <dt>GitHub, Jira</dt><dd>GitHub: {trackerText(a.github_state)} · Jira: {trackerText(a.jira_state)}</dd>
        </dl>

        <h3>Actions</h3>
        <div className="acct-actions-grid">
          <form action={enterAccount} className="stack">
            <input type="hidden" name="tenant" value={a.tenant_id} />
            <div className="field"><label htmlFor={`${id}-enter`}>Reason for entering (optional, logged)</label><input id={`${id}-enter`} name="reason" maxLength={500} /></div>
            <div><button className="btn btn-primary" type="submit">Enter account</button> <span className="muted">{a.access_override ? "read-only" : "default access"}</span></div>
          </form>
          <form action={setSuspended} className="stack">
            <input type="hidden" name="tenant" value={a.tenant_id} />
            <input type="hidden" name="suspend" value={paused ? "0" : "1"} />
            <div className="field"><label htmlFor={`${id}-pause`}>{paused ? "Note (optional, logged)" : "Reason for pausing (optional, logged)"}</label><input id={`${id}-pause`} name="reason" maxLength={500} /></div>
            <div><button className={paused ? "btn btn-confirm" : "btn"} type="submit" data-testid="pause-account">{paused ? "Resume access" : "Pause access"}</button></div>
          </form>
          <form action={setPlan} className="stack">
            <input type="hidden" name="tenant" value={a.tenant_id} />
            <div className="field"><label htmlFor={`${id}-plan`}>Plan</label><input id={`${id}-plan`} name="plan" defaultValue={a.plan} maxLength={40} /></div>
            <div><button className="btn" type="submit">Save plan</button></div>
          </form>
          <form action={setAccountLevel} className="stack">
            <input type="hidden" name="tenant" value={a.tenant_id} />
            <input type="hidden" name="level" value={a.access_override ? "read_write" : "read_only"} />
            <p className="muted">Platform access: <strong>{a.access_override ? "restricted to read-only" : "default"}</strong></p>
            <div><button className="btn" type="submit">{a.access_override ? "Remove restriction" : "Restrict to read-only"}</button></div>
          </form>
        </div>

        <Members account={a} emailEnabled={emailEnabled} fixture={fixtureMembers} />

        <details className="delete-account">
          <summary>Delete account…</summary>
          <form action={deleteAccount} className="stack">
            <input type="hidden" name="tenant" value={a.tenant_id} />
            <p className="error">Deletes <strong>{a.name}</strong> with its {a.member_count} members, {a.project_count} projects and {num(a.item_count)} line items. This cannot be undone.</p>
            <label>Type the account name to confirm<input name="confirm_name" autoComplete="off" required aria-label={`Type ${a.name} to confirm deleting it`} /></label>
            <button className="btn btn-danger" type="submit" data-testid="delete-account">Delete account for good</button>
          </form>
        </details>
      </div>
    </div>
  );
}

function Members({ account: a, emailEnabled, fixture }: { account: AccountRow; emailEnabled: boolean; fixture?: MemberRow[] }) {
  const id = useId();
  const [rows, setRows] = useState<MemberRow[] | null>(fixture ?? null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [link, setLink] = useState<Extract<InviteResult, { ok: true }> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (fixture) return;
    let live = true;
    void loadAccountMembers(a.tenant_id).then((r) => { if (!live) return; if (r.ok) { setRows(r.rows); setError(null); } else setError(r.error); });
    return () => { live = false; };
  }, [a.tenant_id, reload, fixture]);

  const run = async (key: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) => {
    setBusy(key); setNote(null); setError(null);
    const r = await fn();
    setBusy(null);
    if (r.ok) { setNote(done); setReload((n) => n + 1); } else setError(r.error);
  };
  const send = async (delivery: "email" | "link") => {
    setBusy("invite"); setNote(null); setError(null); setLink(null);
    const r = await inviteMember(a.tenant_id, email, role, delivery);
    setBusy(null);
    if (r.ok) { setLink(r); setEmail(""); setReload((n) => n + 1); } else setError(r.error);
  };
  const renew = async (invitationId: string, delivery: "email" | "link") => {
    setBusy(invitationId); setNote(null); setError(null); setLink(null);
    const r = await renewInvitation(invitationId, a.tenant_id, delivery);
    setBusy(null);
    if (r.ok) { setLink(r); setReload((n) => n + 1); } else setError(r.error);
  };

  return (
    <>
      <h3>People {rows ? <span className="muted">({rows.filter((r) => r.kind === "member").length} people, {rows.filter((r) => r.kind === "invitation").length} invitations)</span> : null}</h3>
      <p className="muted">Opening this list is logged in the configuration log. Invites and status changes are recorded in the account&rsquo;s audit log under your name. Roles and the Approver flag stay with the account&rsquo;s own admins.</p>
      {error && <p role="alert" className="error">{error}</p>}
      {note && <p role="status" className="notice">{note}</p>}
      {rows === null && !error ? <p className="muted" role="status">Loading people…</p> : null}
      {rows && rows.length === 0 && <p className="muted">Nobody yet.</p>}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="data-table acct-people" data-testid="account-people">
            <caption className="visually-hidden">People in {a.name}</caption>
            <thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Last login</th><th scope="col">AI agents</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((m) => {
                const key = (m.member_id ?? m.invitation_id) as string;
                return (
                  <tr key={key}>
                    <td>{m.name && m.kind === "member" ? <strong>{m.name}</strong> : null}{m.name && m.kind === "member" ? <br /> : null}<span className={m.kind === "member" && m.name ? "muted" : ""}>{m.email}</span>{m.is_service_account ? <span className="pill tone-info"> Service account</span> : null}</td>
                    <td>{ROLE_LABEL[m.role as Role] ?? m.role}{m.is_approver ? " · Approver" : ""}</td>
                    <td>{MEMBER_STATUS_LABEL[m.status]}{m.kind === "invitation" ? <span className="muted"> · expires {m.expires_at?.slice(0, 10)}</span> : null}</td>
                    <td>{m.kind === "member" ? when(m.last_login_at, "Never") : "—"}</td>
                    <td>{m.ai_agents.length ? m.ai_agents.join(", ") : <span className="muted">None</span>}</td>
                    <td className="acct-row-actions">
                      {m.kind === "invitation" ? (
                        <>
                          {emailEnabled && <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => void renew(key, "email")}>Resend email</button>}
                          <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => void renew(key, "link")} title="Makes a new link and stops the old one">New link</button>
                          <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => void run(key, () => cancelInvitation(key), "Invitation cancelled.")}>Cancel</button>
                        </>
                      ) : memberMoves(m).map((mv) => (
                        <button key={mv.status} type="button" className="btn btn-sm" disabled={busy !== null} aria-label={`${mv.label} ${m.email}`} onClick={() => void run(key, () => changePersonStatus(key, mv.status), `${m.email}: ${mv.label.toLowerCase()} done.`)}>{mv.label}</button>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h4>Invite someone</h4>
      <div className="row-form">
        <div className="field"><label htmlFor={`${id}-email`}>Email</label><input id={`${id}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field">
          <label htmlFor={`${id}-role`}>Role</label>
          <select id={`${id}-role`} value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
        </div>
        {emailEnabled && <button type="button" className="btn btn-confirm" disabled={busy !== null || !email.trim()} onClick={() => void send("email")}>{busy === "invite" ? "Sending…" : "Send invitation email"}</button>}
        <button type="button" className={emailEnabled ? "btn" : "btn btn-primary"} disabled={busy !== null || !email.trim()} onClick={() => void send("link")}>Create link only</button>
      </div>
      <p className="muted">The invitation never carries Approver. The link works once, only for that address, for 7 days. The person is told it comes from Product Velocity on the account&rsquo;s behalf.</p>
      {link && <LinkNotice state={{ link: link.link, email: link.email, emailed: link.emailed, emailNote: link.note ?? undefined }} />}
      {isPaused(a) && <p className="muted">While the account is paused, invited people can accept but cannot open it until you resume.</p>}
    </>
  );
}
