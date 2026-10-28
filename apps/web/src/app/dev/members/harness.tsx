"use client";

import { useEffect, useMemo, useState } from "react";
import { MEMBER_STATUS_LABEL, allowedStatusTargets, type MemberStatus } from "@pv/domain";
import { AppHeader } from "@/components/app-header";
import { WorkspaceProvider } from "@/features/workspace/provider";
import { MemoryWorkspaceStore } from "@/features/workspace/store";
import { harnessLookups } from "../harness-data";
import { MembersGrid, type GridRow, type MemberActions } from "../../(workspace)/settings/members/members-grid";

const day = (n: number) => new Date(Date.UTC(2026, 9, 28 - n, 9)).toISOString();
const person = (i: number, o: Partial<GridRow>): GridRow => ({
  member_id: `m${i}`, invitation_id: null, user_id: `u${i}`, email: `person${i}@meridian.test`, name: null, role: "viewer", is_approver: false,
  is_service_account: false, status: "active", created_at: day(30 - i), last_login_at: day(i), github_username: null, expires_at: null, email_status: null, ...o,
});

const ROWS: GridRow[] = [
  person(0, { member_id: "m0", user_id: "me", email: "ashu@meridian.test", name: "Ashu Mathura", role: "admin", is_approver: true }),
  person(1, { email: "lena@meridian.test", name: "Lena Ortiz", role: "creator" }),
  person(2, { email: "omar@meridian.test", name: "Omar Haddad", role: "creator", is_approver: true }),
  person(3, { status: "paused" }),
  person(4, { status: "revoked", last_login_at: null }),
  ...[5, 6, 7, 8].map((i) => person(i, { status: "requested", last_login_at: null, created_at: day(1) })),
  { ...person(9, {}), member_id: null, user_id: null, invitation_id: "inv1", email: "new.hire@meridian.test", status: "invited", last_login_at: null, expires_at: day(-5), email_status: "sent" },
];

/** In-memory stand-ins for the server actions, with the same rules as the database (transitions, own row, last admin). */
export function HarnessMembers({ admin }: { admin: boolean }) {
  const [state] = useState(() => ({ current: { rows: ROWS.map((r) => ({ ...r })), calls: [] as unknown[] } }));
  const actions: MemberActions = {
    async changeMemberStatus(memberIds, invitationIds, status) {
      state.current.calls.push({ memberIds, invitationIds, status });
      const results = [
        ...memberIds.map((id) => {
          const r = state.current.rows.find((x) => x.member_id === id)!;
          const ok = allowedStatusTargets(r.status).includes(status as MemberStatus);
          if (ok) r.status = status as MemberStatus;
          return { key: id, email: r.email, ok, ...(ok ? { emailed: status === "active" } : { reason: `A ${r.status} member cannot become ${status}.` }) };
        }),
        ...invitationIds.map((id) => {
          state.current.rows = state.current.rows.filter((x) => x.invitation_id !== id);
          return { key: id, email: "new.hire@meridian.test", ok: true };
        }),
      ];
      return { ok: true as const, results };
    },
    async updateMember(memberId, role, isApprover) {
      state.current.calls.push({ memberId, role, isApprover });
      return memberId === "m2" ? { ok: false as const, error: "A workspace must keep at least one admin." } : { ok: true as const };
    },
    async setMemberGithubUsername() { return { ok: true as const }; },
  };
  useEffect(() => { (window as unknown as { __pv: unknown }).__pv = state.current; }, [state]);
  const store = useMemo(() => Object.assign(new MemoryWorkspaceStore({ scopes: [] }), { projects: harnessLookups.projects }), []);
  return (
    <WorkspaceProvider store={store} projects={harnessLookups.projects} canEdit={admin} canAdmin={admin}>
    <div className="shell">
      <AppHeader tenantName="Meridian Media" email="ashu@meridian.test" roleLabel="Admin" isApprover current="grid" />
      <main className="content">
        <div className="page-wide">
          <h1>Members</h1>
          <p className="muted">Everyone who is, was or asked to be part of Meridian Media, in one table. ({MEMBER_STATUS_LABEL.requested} people get no access until you set them to Active.)</p>
          <MembersGrid
            rows={admin ? ROWS : ROWS.filter((r) => r.status === "active")}
            isAdmin={admin}
            selfUserId="me"
            workspaceName="Meridian Media"
            emailEnabled
            actions={actions}
            inviteForm={admin ? <p>Invite form (server action; covered by the existing invitation tests).</p> : null}
            renderResend={() => <button className="btn" type="button">Resend email</button>}
          />
        </div>
      </main>
    </div>
    </WorkspaceProvider>
  );
}
