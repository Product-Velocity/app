import { requireWorkspace } from "@/lib/session";
import { MEMBER_STATUSES, type MemberStatus } from "@pv/domain";
import { emailConfigured } from "@/lib/email/resend";
import { MembersGrid, type GridRow } from "./members-grid";
import { InviteForm } from "./forms";
import { PeopleNotInvited, type NotInvitedPerson } from "./people-list";
import { addPerson, changeMemberStatus, linkPerson, removePerson, setMemberGithubUsername, updateMember, updatePerson } from "./actions";
import type { Role } from "@/lib/roles";

export const metadata = { title: "Members · Product Velocity" };

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const { supabase, user, active } = await requireWorkspace("/settings/members");
  if (active.isDemoAccount) {
    // the real tenant's members (including their email addresses) are not shown to an anonymous public visitor (issue #559)
    return (
      <div className="page-wide">
        <h1>Members</h1>
        <p className="notice">Member details are not shown in the read-only demo.</p>
      </div>
    );
  }
  const isAdmin = active.role === "admin" && !active.platform; // a platform admin reads the roster; who has access is the customer's decision
  const initialFilter = (MEMBER_STATUSES as readonly string[]).includes(status ?? "") ? (status as MemberStatus) : "all";

  let rows: GridRow[] = [];
  if (isAdmin) {
    const { data } = await supabase.rpc("members_grid", { p_tenant: active.tenantId });
    rows = (data ?? []) as GridRow[];
  } else {
    // everyone else sees the active people only
    const { data: people } = await supabase.rpc("tenant_directory", { p_tenant: active.tenantId });
    const { data: extra } = await supabase.from("active_tenant_members").select("user_id, github_username, created_at").eq("tenant_id", active.tenantId);
    const more = new Map(((extra ?? []) as { user_id: string; github_username: string | null; created_at: string }[]).map((m) => [m.user_id, m]));
    rows = ((people ?? []) as { member_id: string; user_id: string; email: string; role: Role; is_approver: boolean; is_service_account: boolean; joined_at: string }[]).map((p) => ({
      member_id: p.member_id, invitation_id: null, user_id: p.user_id, email: p.email, name: null, role: p.role, is_approver: p.is_approver,
      is_service_account: p.is_service_account, status: "active", created_at: p.joined_at, last_login_at: null,
      github_username: more.get(p.user_id)?.github_username ?? null, expires_at: null, email_status: null,
    }));
  }

  // people named on initiatives before they were invited (issue #691): only admins see their addresses and can invite them
  let notInvited: NotInvitedPerson[] = [];
  let activeMembers: { user_id: string; email: string }[] = [];
  if (isAdmin) {
    const [{ data: dir }, { data: usage }] = await Promise.all([
      supabase.rpc("people_directory", { p_tenant: active.tenantId }),
      supabase.rpc("people_usage", { p_tenant: active.tenantId }),
    ]);
    const used = new Map(((usage ?? []) as { person_id: string; initiatives: number }[]).map((u) => [u.person_id, u.initiatives]));
    const all = (dir ?? []) as { person_id: string; user_id: string | null; name: string; email: string | null; status: string; is_service_account: boolean }[];
    notInvited = all.filter((p) => !p.user_id && p.status === "not_invited").map((p) => ({ id: p.person_id, name: p.name, email: p.email, initiatives: used.get(p.person_id) ?? 0 }));
    activeMembers = all.filter((p) => p.user_id && !p.is_service_account && p.email).map((p) => ({ user_id: p.user_id!, email: p.email! }));
  }

  return (
    <div className="page-wide">
      <h1>Members</h1>
      <p className="muted">
        Everyone who is, was or asked to be part of {active.tenantName}, in one table. Roles control what people can do. Approver is a
        separate permission: only Approvers can mark work &ldquo;Ready for build&rdquo;. Claude can never be an Approver. People who sign up
        with an address at an authorized domain appear as Requested Access and get no access until you set them to Active.
        {isAdmin && " Select rows to change several at once."}
      </p>
      <MembersGrid
        rows={rows}
        isAdmin={isAdmin}
        selfUserId={user.id}
        workspaceName={active.tenantName}
        emailEnabled={emailConfigured()}
        initialFilter={initialFilter}
        actions={{ changeMemberStatus, updateMember, setMemberGithubUsername }}
        inviteForm={isAdmin ? <InviteForm workspaceName={active.tenantName} emailEnabled={emailConfigured()} /> : null}
      />
      {isAdmin && (
        <PeopleNotInvited
          people={notInvited}
          members={activeMembers}
          workspaceName={active.tenantName}
          emailEnabled={emailConfigured()}
          actions={{ addPerson, updatePerson, removePerson, linkPerson }}
        />
      )}
    </div>
  );
}
