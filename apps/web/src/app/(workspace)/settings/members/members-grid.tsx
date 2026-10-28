"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { MEMBER_STATUSES, MEMBER_STATUS_LABEL, allowedStatusTargets, canChangeStatus, type MemberStatus } from "@pv/domain";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/roles";
import { emailStatusText } from "@/lib/email/invitation";
import type { ReactNode } from "react";
import type { SaveResult, StatusOutcome } from "./actions";
import { ResendControls } from "./forms";

/** The writes the grid makes. The page passes the real server actions; the test page at /dev/members passes in-memory ones. */
export type MemberActions = {
  changeMemberStatus: (memberIds: string[], invitationIds: string[], status: string) => Promise<StatusOutcome>;
  updateMember: (memberId: string, role: string, isApprover: boolean) => Promise<SaveResult>;
  setMemberGithubUsername: (userId: string, username: string) => Promise<SaveResult>;
};

export type GridRow = {
  member_id: string | null;
  invitation_id: string | null;
  user_id: string | null;
  email: string;
  name: string | null;
  role: Role;
  is_approver: boolean;
  is_service_account: boolean;
  status: MemberStatus;
  created_at: string;
  last_login_at: string | null;
  github_username: string | null;
  expires_at: string | null;
  email_status: string | null;
};

const rowKey = (r: GridRow) => (r.member_id ?? r.invitation_id) as string;
const ORDER: Record<MemberStatus, number> = { requested: 0, invited: 1, active: 2, paused: 3, revoked: 4 };
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

/**
 * The unified Workspace Members grid (issue #216): every lifecycle state in one table, inline role / Approver / status edits that save
 * as you change them (and put the old value back if the save is refused), multi-row selection with a batch bar, and Create new invite.
 */
export function MembersGrid(props: {
  rows: GridRow[];
  isAdmin: boolean;
  selfUserId: string;
  workspaceName: string;
  emailEnabled: boolean;
  initialFilter?: MemberStatus | "all";
  actions: MemberActions;
  /** The invitation form (the Create new invite drawer). */
  inviteForm?: ReactNode;
  /** Replaces the Resend / New link controls of a pending invitation (the test page does; a server page cannot pass a function). */
  renderResend?: (invitationId: string) => ReactNode;
}) {
  const [rows, setRows] = useState(props.rows);
  const [seenRows, setSeenRows] = useState(props.rows);
  if (seenRows !== props.rows) { setSeenRows(props.rows); setRows(props.rows); } // the server sent fresh rows
  const [filter, setFilter] = useState<MemberStatus | "all">(props.initialFilter ?? "all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [invite, setInvite] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; lines: string[] } | null>(null);
  const [busy, startTransition] = useTransition();
  const headCheck = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => (filter === "all" || r.status === filter) && (!q || r.email.toLowerCase().includes(q) || (r.name ?? "").toLowerCase().includes(q)))
      .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.email.localeCompare(b.email));
  }, [rows, filter, query]);

  const selectable = (r: GridRow) => props.isAdmin && !r.is_service_account && r.user_id !== props.selfUserId;
  const selectedRows = rows.filter((r) => selected.has(rowKey(r)));
  const allShownSelected = shown.filter(selectable).length > 0 && shown.filter(selectable).every((r) => selected.has(rowKey(r)));
  useEffect(() => {
    if (headCheck.current) headCheck.current.indeterminate = !allShownSelected && shown.some((r) => selected.has(rowKey(r)));
  }, [allShownSelected, shown, selected]);

  const toggle = (k: string) => setSelected((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleAll = () => setSelected((s) => {
    const n = new Set(s);
    if (allShownSelected) shown.forEach((r) => n.delete(rowKey(r))); else shown.filter(selectable).forEach((r) => n.add(rowKey(r)));
    return n;
  });

  /** Optimistic status change for the given rows, put back (per row) if the database refuses it. */
  function applyStatus(targets: GridRow[], status: "active" | "paused" | "revoked") {
    const before = new Map(targets.map((r) => [rowKey(r), r]));
    setRows((all) => all.map((r) => (before.has(rowKey(r)) ? { ...r, status: r.status === "invited" ? "invited" : status } : r)));
    setMessage({ tone: "ok", lines: ["Saving…"] });
    startTransition(async () => {
      const out = await props.actions.changeMemberStatus(
        targets.filter((r) => r.member_id).map((r) => r.member_id!),
        targets.filter((r) => r.invitation_id).map((r) => r.invitation_id!),
        status,
      );
      if (!out.ok) {
        setRows((all) => all.map((r) => before.get(rowKey(r)) ?? r));
        setMessage({ tone: "error", lines: [out.error] });
        return;
      }
      const failed = out.results.filter((r) => !r.ok);
      const okKeys = new Set(out.results.filter((r) => r.ok).map((r) => r.key));
      setRows((all) =>
        all
          .map((r) => (before.has(rowKey(r)) && !okKeys.has(rowKey(r)) ? before.get(rowKey(r))! : r))
          .filter((r) => !(r.status === "invited" && okKeys.has(rowKey(r)) && status === "revoked")),
      );
      setSelected((s) => { const n = new Set(s); out.results.filter((r) => r.ok).forEach((r) => n.delete(r.key)); return n; });
      const done = out.results.filter((r) => r.ok);
      const mailed = done.filter((r) => r.emailed).length;
      const lines = [
        `${done.length} ${done.length === 1 ? "person is" : "people are"} now ${MEMBER_STATUS_LABEL[status].toLowerCase()}.` + (mailed ? ` ${mailed} confirmation ${mailed === 1 ? "email" : "emails"} sent.` : ""),
        ...(status === "active" && done.some((r) => r.emailed === false) && done.some((r) => r.email) ? ["Approval emails were not sent (email is not set up or failed). Tell people they can sign in."] : []),
        ...failed.map((f) => `${f.email ?? "A row"}: ${f.reason}`),
      ];
      setMessage({ tone: failed.length ? "error" : "ok", lines });
    });
  }

  const batchTargets = (["active", "paused", "revoked"] as const).filter((t) => canChangeStatus(selectedRows.map((r) => r.status), t));

  return (
    <div className="stack">
      <div className="members-toolbar" role="toolbar" aria-label="Filter members">
        {(["all", ...MEMBER_STATUSES] as const).map((s) => (
          <button key={s} type="button" className={`chip${filter === s ? " chip-on" : ""}`} aria-pressed={filter === s} onClick={() => setFilter(s)}>
            {s === "all" ? "All" : MEMBER_STATUS_LABEL[s]} <span className="muted">{counts[s] ?? 0}</span>
          </button>
        ))}
        <input type="search" aria-label="Search members" placeholder="Search name or email" value={query} onChange={(e) => setQuery(e.target.value)} className="members-search" />
        {props.isAdmin && props.inviteForm && <button type="button" className="btn btn-primary" aria-expanded={invite} onClick={() => setInvite((v) => !v)}>Create new invite</button>}
      </div>

      {invite && props.isAdmin && (
        <div className="card" role="region" aria-label="Create new invite">
          {props.inviteForm}
        </div>
      )}

      {props.isAdmin && selectedRows.length > 0 && (
        <div className="bulk-bar" role="region" aria-label="Batch actions" onKeyDown={(e) => { if (e.key === "Escape") setSelected(new Set()); }}>
          <span className="bulk-count">{selectedRows.length} selected</span>
          <span className="bulk-sep" />
          {batchTargets.length === 0 && <span className="muted">These rows have no status change in common.</span>}
          {batchTargets.map((t) => (
            <button key={t} type="button" className="bulk-btn" disabled={busy} onClick={() => applyStatus(selectedRows, t)}>
              {t === "active" ? (selectedRows.every((r) => r.status === "requested") ? "Approve (set Active)" : "Set Active") : t === "paused" ? "Pause" : "Revoke"}
            </button>
          ))}
          <button type="button" className="bulk-link" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      <div role="status" aria-live="polite">
        {message && (
          <div className={message.tone === "error" ? "notice notice-error" : "notice"}>
            {message.lines.map((l, i) => <p key={i} style={{ margin: 0 }}>{l}</p>)}
          </div>
        )}
      </div>

      <div className="card members-card">
        <table className="table members-table">
          <thead>
            <tr>
              {props.isAdmin && (
                <th scope="col" className="col-check">
                  <input ref={headCheck} type="checkbox" aria-label="Select all shown rows" checked={allShownSelected} onChange={toggleAll} />
                </th>
              )}
              <th scope="col">Member</th>
              <th scope="col">Role</th>
              <th scope="col">Approver</th>
              <th scope="col">Status</th>
              <th scope="col">Created</th>
              <th scope="col">Last login</th>
              <th scope="col">GitHub username</th>
              {props.isAdmin && <th scope="col"><span className="visually-hidden">Invitation actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={9} className="muted">{rows.length === 0 ? "No members yet." : "No members match."}</td></tr>
            )}
            {shown.map((r) => (
              <GridRowView key={`${rowKey(r)}:${r.role}:${r.is_approver}`} r={r} {...props} selected={selected.has(rowKey(r))} selectable={selectable(r)} onToggle={() => toggle(rowKey(r))} onStatus={(s) => applyStatus([r], s)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GridRowView(props: {
  r: GridRow; isAdmin: boolean; selfUserId: string; actions: MemberActions; emailEnabled: boolean; renderResend?: (invitationId: string) => ReactNode; selected: boolean; selectable: boolean;
  onToggle: () => void; onStatus: (s: "active" | "paused" | "revoked") => void;
}) {
  const { r, isAdmin } = props;
  const [role, setRole] = useState<Role>(r.role);
  const [approver, setApprover] = useState(r.is_approver);
  const [note, setNote] = useState("");
  const [, startTransition] = useTransition();
  const invited = r.status === "invited";
  const locked = !isAdmin || invited || r.is_service_account;
  const self = r.user_id === props.selfUserId;

  function save(nextRole: Role, nextApprover: boolean) {
    const prev = { role, approver };
    setRole(nextRole); setApprover(nextApprover); setNote("Saving…");
    startTransition(async () => {
      const res = await props.actions.updateMember(r.member_id!, nextRole, nextApprover);
      if (res.ok) setNote("Saved");
      else { setRole(prev.role); setApprover(prev.approver); setNote(res.error); }
    });
  }

  const targets = allowedStatusTargets(r.status).filter((t): t is "active" | "paused" | "revoked" => t !== "requested" && t !== "invited");
  const display = r.name ? <><strong>{r.name}</strong><br /><span className="muted">{r.email}</span></> : <strong>{r.email}</strong>;

  return (
    <tr aria-selected={props.selected} className={props.selected ? "row-selected" : undefined}>
      {isAdmin && (
        <td className="col-check">
          <input type="checkbox" aria-label={`Select ${r.email}`} checked={props.selected} disabled={!props.selectable} onChange={props.onToggle} title={self ? "You cannot change your own status" : r.is_service_account ? "Service account" : undefined} />
        </td>
      )}
      <td>{display}{self ? <span className="muted"> (you)</span> : null}</td>
      <td>
        {locked ? ROLE_LABEL[r.role] : (
          <select aria-label={`Role of ${r.email}`} value={role} onChange={(e) => save(e.target.value as Role, approver)}>
            {ROLES.map((x) => <option key={x} value={x}>{ROLE_LABEL[x]}</option>)}
          </select>
        )}
      </td>
      <td>
        {locked ? (r.is_approver ? "Yes" : "No") : (
          <label className="check"><input type="checkbox" aria-label={`Approver: ${r.email}`} checked={approver} onChange={(e) => save(role, e.target.checked)} /> {approver ? "Yes" : "No"}</label>
        )}
        <span className="status" role="status" aria-live="polite"> {note}</span>
      </td>
      <td>
        {!isAdmin || r.is_service_account || self ? <StatusText status={r.status} /> : invited ? (
          <>
            <StatusText status="invited" />
            <button type="button" className="bulk-link" onClick={() => props.onStatus("revoked")} aria-label={`Cancel invitation for ${r.email}`}> Cancel</button>
          </>
        ) : (
          <select aria-label={`Status of ${r.email}`} value={r.status} onChange={(e) => props.onStatus(e.target.value as "active" | "paused" | "revoked")}>
            <option value={r.status}>{MEMBER_STATUS_LABEL[r.status]}</option>
            {targets.map((t) => <option key={t} value={t}>{MEMBER_STATUS_LABEL[t]}</option>)}
          </select>
        )}
      </td>
      <td title={r.created_at}>{day(r.created_at)}</td>
      <td title={r.last_login_at ?? undefined}>{invited ? <span className="muted">Not yet</span> : r.last_login_at ? day(r.last_login_at) : <span className="muted">Never</span>}</td>
      <td>
        {invited ? <span className="muted">{emailStatusText(r.email_status ?? "not_sent", null, null)}</span> : isAdmin && !r.is_service_account && r.user_id && r.status === "active" ? (
          <GithubName userId={r.user_id} current={r.github_username ?? ""} label={r.email} save={props.actions.setMemberGithubUsername} />
        ) : r.github_username ? `@${r.github_username}` : <span className="muted">none</span>}
      </td>
      {isAdmin && <td>{invited && r.invitation_id ? (props.renderResend ?? ((id) => <ResendControls id={id} emailEnabled={props.emailEnabled} />))(r.invitation_id) : null}</td>}
    </tr>
  );
}

function StatusText({ status }: { status: MemberStatus }) {
  return <span className={`status-text status-${status}`}>{MEMBER_STATUS_LABEL[status]}</span>;
}

function GithubName({ userId, current, label, save: persist }: { userId: string; current: string; label: string; save: MemberActions["setMemberGithubUsername"] }) {
  const [value, setValue] = useState(current);
  const [status, setStatus] = useState("");
  const [, startTransition] = useTransition();
  const save = () => {
    if (value.trim() === current) return;
    setStatus("Saving…");
    startTransition(async () => {
      const r = await persist(userId, value);
      setStatus(r.ok ? "Saved" : r.error);
    });
  };
  return (
    <>
      <input aria-label={`GitHub username of ${label}`} value={value} maxLength={40} autoComplete="off" spellCheck={false} placeholder="none" onChange={(e) => setValue(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }} />
      <span role="status" className="muted" aria-live="polite"> {status}</span>
    </>
  );
}
