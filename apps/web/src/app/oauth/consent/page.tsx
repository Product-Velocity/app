import { redirect } from "next/navigation";
import { assistantLabel, CLAUDE_CAN, CLAUDE_CANNOT, claudeMayWrite, detectAssistant } from "@pv/domain";
import { requireWorkspace } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/roles";
import { BrandLogo } from "@/components/brand-logo";
import { decide } from "./actions";

export const metadata = { title: "Connect an AI assistant · Product Velocity" };

const ERRORS: Record<string, string> = {
  choose: "Choose at least one workspace first.",
  single: "One of the workspaces you chose allows AI assistants only on their own. Choose that one alone, or leave it out.",
  "needs-migration": "This deployment's database does not support several workspaces yet (migration 0058). Choose one workspace.",
  off: "AI assistants are switched off for that workspace. A workspace admin can switch them on under Connect an AI assistant.",
  "1": "That did not work. Please try again.",
};

/** Consent screen for an AI assistant connection (docs/20 FR-1, docs/27): the client, the workspace, the role the assistant will have, and what it can and cannot do. */
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string; error?: string }>;
}) {
  const { authorization_id: id, error } = await searchParams;
  if (!id) redirect("/");
  const next = `/oauth/consent?authorization_id=${encodeURIComponent(id)}`;
  const { supabase, memberships, active } = await requireWorkspace(next);

  const { data, error: e } = await supabase.auth.oauth.getAuthorizationDetails(id);
  if (data && "redirect_url" in data) redirect(data.redirect_url);
  if (e || !data) {
    return (
      <main className="auth-page">
        <div className="card auth-card">
          <BrandLogo size={52} />
          <h1>This request is no longer valid</h1>
          <p role="alert" className="error">Go back to your assistant and try connecting again.</p>
        </div>
      </main>
    );
  }

  const kind = detectAssistant(data.client.name);
  const who = kind === "other" ? data.client.name : assistantLabel(kind);
  const ids = memberships.map((m) => m.tenantId);
  let { data: flags, error: flagError } = await supabase.from("tenants").select("id, claude_enabled, claude_single_only").in("id", ids);
  if (flagError) ({ data: flags, error: flagError } = (await supabase.from("tenants").select("id, claude_enabled").in("id", ids)) as never); // before migration 0058
  const on = new Set((flags ?? []).filter((t) => t.claude_enabled).map((t) => t.id as string));
  const single = new Set(((flags ?? []) as { id: string; claude_single_only?: boolean }[]).filter((t) => t.claude_single_only).map((t) => t.id));
  const choices = memberships.map((m) => ({ ...m, enabled: on.has(m.tenantId), single: single.has(m.tenantId) }));
  const firstOn = choices.find((c) => c.tenantId === active.tenantId && c.enabled) ?? choices.find((c) => c.enabled);

  return (
    <main className="auth-page">
      <div className="card auth-card">
        <BrandLogo size={52} />
        <h1>Connect {who} to Product Velocity?</h1>
        {flagError && <p role="alert" className="error">This deployment&rsquo;s database is missing migration 0043, so assistants cannot be connected yet.</p>}
        {error && <p role="alert" className="error">{ERRORS[error] ?? ERRORS["1"]}</p>}
        <p>
          <strong>{data.client.name}</strong> will act as <strong>{data.user.email}</strong>, with your role in each workspace you choose. Choose one, or several: with several, {who} has to name the workspace on every request and asks you when you have not said.
        </p>

        <form action={decide} className="stack">
          <input type="hidden" name="authorization_id" value={id} />
          <fieldset className="consent-workspaces">
            <legend>Workspaces</legend>
            {choices.map((c) => (
              <label key={c.tenantId}>
                <input type="checkbox" name="tenant_id" value={c.tenantId} defaultChecked={firstOn?.tenantId === c.tenantId} disabled={!c.enabled} />
                <span>
                  {c.tenantName} · your role: {ROLE_LABEL[c.role]}
                  {claudeMayWrite(c.role) ? "" : ` (${who} can read, not change)`}
                  {c.enabled && c.single && " · its admins allow assistants here only on their own: choose it alone"}
                  {!c.enabled && (
                    <>
                      {" · AI assistants are switched off here. "}
                      {c.role === "admin" ? (
                        <a href="/settings/claude">Switch it on under Connect an AI assistant</a>
                      ) : (
                        "A workspace admin can switch it on."
                      )}
                    </>
                  )}
                </span>
              </label>
            ))}
          </fieldset>

          <div className="two-col">
            <div>
              <strong>{who} can</strong>
              <ul className="consent-list">{CLAUDE_CAN.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
            <div>
              <strong>{who} cannot</strong>
              <ul className="consent-list">{CLAUDE_CANNOT.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          </div>
          <p className="muted">You can revoke this at any time under Connect an AI assistant in your account menu. It stops working on its next call.</p>

          <button className="btn btn-primary btn-wide" name="decision" value="approve" type="submit" disabled={!firstOn}>
            Approve
          </button>
          <button className="btn btn-wide" name="decision" value="deny" type="submit" formNoValidate>
            Deny
          </button>
        </form>
      </div>
    </main>
  );
}
