import Link from "next/link";
import { requireWorkspace } from "@/lib/session";
import { ROLE_HELP, ROLE_LABEL } from "@/lib/roles";

export const metadata = { title: "Home · Product Velocity" };

export default async function HomePage() {
  const { user, active } = await requireWorkspace("/home");
  return (
    <>
      <h1>{active.tenantName}</h1>
      <p className="muted">
        Signed in as {user.email}. Your role: <strong>{ROLE_LABEL[active.role]}</strong> (
        {ROLE_HELP[active.role].toLowerCase()})
        {active.isApprover ? ", and you are an Approver" : ""}.
      </p>
      <div className="card">
        <p>The roadmap arrives in the next phase. For now you can manage people and security.</p>
        <p>
          <Link href="/settings/members">Invite your team</Link> ·{" "}
          <Link href="/settings/security">Set up two-factor sign-in</Link>
        </p>
      </div>
    </>
  );
}
