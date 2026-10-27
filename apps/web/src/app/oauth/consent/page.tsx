import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { BrandLogo } from "@/components/brand-logo";
import { decide } from "./actions";

export const metadata = { title: "Connect Claude · Product Velocity" };

/** Minimal consent screen for the MCP connection (spike S8b; full design in slice 2). */
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string; error?: string }>;
}) {
  const { authorization_id: id, error } = await searchParams;
  if (!id) redirect("/");
  const next = `/oauth/consent?authorization_id=${encodeURIComponent(id)}`;
  const { supabase, memberships } = await requireWorkspace(next);

  const { data, error: e } = await supabase.auth.oauth.getAuthorizationDetails(id);
  if (data && "redirect_url" in data) redirect(data.redirect_url);
  if (e || !data) {
    return (
      <main className="auth-page">
        <div className="card auth-card">
          <BrandLogo size={44} />
          <h1>This request is no longer valid</h1>
          <p role="alert" className="error">Go back to Claude and try connecting again.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <div className="card auth-card">
        <BrandLogo size={44} />
        <h1>Connect {data.client.name} to Product Velocity?</h1>
        {error && <p role="alert" className="error">That did not work. Please try again.</p>}
        <p>
          <strong>{data.client.name}</strong> will act as <strong>{data.user.email}</strong> and see what you can see in
          {memberships.length === 1 ? " this workspace" : " these workspaces"}:
        </p>
        <ul>
          {memberships.map((m) => (
            <li key={m.tenantId}>
              {m.tenantName} (your role: {m.role})
            </li>
          ))}
        </ul>
        <p>In this first version Claude can only read the list of workspaces and projects. You can revoke access at any time.</p>
        <form action={decide} className="stack">
          <input type="hidden" name="authorization_id" value={id} />
          <button className="btn btn-primary btn-wide" name="decision" value="approve" type="submit">
            Approve
          </button>
          <button className="btn btn-wide" name="decision" value="deny" type="submit">
            Deny
          </button>
        </form>
      </div>
    </main>
  );
}
