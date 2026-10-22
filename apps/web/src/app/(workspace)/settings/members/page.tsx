import { requireWorkspace } from "@/lib/session";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { InviteForm, MemberControls } from "./forms";
import { removeMember, revokeInvitation } from "./actions";

export const metadata = { title: "Members · Product Velocity" };

type Person = {
  member_id: string;
  user_id: string;
  email: string;
  role: Role;
  is_approver: boolean;
  is_service_account: boolean;
};

export default async function MembersPage() {
  const { supabase, user, active } = await requireWorkspace("/settings/members");
  const isAdmin = active.role === "admin";

  const { data: people } = await supabase.rpc("tenant_directory", { p_tenant: active.tenantId });
  const { data: invites } = isAdmin
    ? await supabase
        .from("invitations")
        .select("id, email, role, is_approver, expires_at")
        .eq("tenant_id", active.tenantId)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
    : { data: [] };

  return (
    <>
      <h1>Members</h1>
      <p className="muted">
        Roles control what people can do. Approver is a separate permission: only Approvers can
        mark work &ldquo;Ready for build&rdquo;. Claude can never be an Approver.
      </p>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Approver</th>
              {isAdmin && (
                <th scope="col">
                  <span className="visually-hidden">Remove</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {((people ?? []) as Person[]).map((p) => (
              <tr key={p.member_id}>
                <td>
                  {p.email}
                  {p.user_id === user.id ? " (you)" : ""}
                </td>
                {isAdmin ? (
                  <MemberControls
                    memberId={p.member_id}
                    role={p.role}
                    isApprover={p.is_approver}
                    disabled={p.is_service_account}
                  />
                ) : (
                  <>
                    <td>{ROLE_LABEL[p.role]}</td>
                    <td>{p.is_approver ? "Approver" : "No"}</td>
                  </>
                )}
                {isAdmin && (
                  <td>
                    <form action={removeMember}>
                      <input type="hidden" name="id" value={p.member_id} />
                      <button className="btn" type="submit">
                        Remove
                      </button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <>
          <h2>Invite someone</h2>
          <div className="card">
            <InviteForm />
          </div>

          <h2>Pending invitations</h2>
          <div className="card">
            {(invites ?? []).length === 0 ? (
              <p className="muted">No pending invitations.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Expires</th>
                    <th scope="col">
                      <span className="visually-hidden">Revoke</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(invites ?? []).map((i) => (
                    <tr key={i.id}>
                      <td>{i.email}</td>
                      <td>
                        {ROLE_LABEL[i.role as Role]}
                        {i.is_approver ? " · Approver" : ""}
                      </td>
                      <td>{new Date(i.expires_at).toISOString().slice(0, 10)}</td>
                      <td>
                        <form action={revokeInvitation}>
                          <input type="hidden" name="id" value={i.id} />
                          <button className="btn" type="submit">
                            Revoke
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}
