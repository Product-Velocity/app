import { requirePlatformAdmin } from "@/lib/session";
import { AccountsTable, type AccountRow } from "./accounts-table";

export const metadata = { title: "All accounts · Product Velocity" };

const NOTICE: Record<string, string> = {
  reauth: "To enter an account with write access, sign in again first (a sign-in within the last 15 minutes is required).",
  "enter-failed": "We could not enter that account.",
  "bad-account": "That account does not exist.",
  left: "You left the account.",
  "account-restricted": "That account is now read-only for platform admins. The change is in its audit log.",
  "account-unrestricted": "The read-only restriction on that account was removed. The change is in its audit log.",
  "plan-saved": "Plan saved.",
  "bad-plan": "Enter a plan name of 1 to 40 characters.",
  failed: "That did not work. Please try again.",
};

/** All accounts console (R-111 FR-2.2): every account with plan, owner, members, projects and last activity; search by name. */
export default async function PlatformAccountsPage({ searchParams }: { searchParams: Promise<{ q?: string; notice?: string }> }) {
  const { q, notice } = await searchParams;
  const { supabase } = await requirePlatformAdmin("/platform");
  const { data: cfg } = await supabase.rpc("platform_config");
  const defaults = (Array.isArray(cfg) ? cfg[0] : cfg) as { default_access_level: string } | undefined;
  const { data } = await supabase.rpc("platform_accounts", { p_search: q?.trim() || null, p_limit: 200 });
  const rows = (data ?? []) as AccountRow[];
  return (
    <div className="page-wide">
      <h1>All accounts</h1>
      <p className="muted">
        Default access when you enter an account: <strong data-testid="default-level">{defaults?.default_access_level === "read_only" ? "read-only" : "read & write"}</strong>
        . Entering an account is logged in that account&rsquo;s audit log, and a banner stays on screen while you are inside.
      </p>
      {notice && NOTICE[notice] && (
        <p role="status" className={notice === "reauth" || notice === "failed" || notice === "enter-failed" ? "notice notice-error" : "notice"}>{NOTICE[notice]}</p>
      )}
      {notice === "reauth" && (
        <form action="/auth/sign-out" method="post">
          <input type="hidden" name="next" value="/sign-in?next=%2Fplatform" />
          <button className="btn btn-primary" type="submit">Sign out and sign in again</button>
        </form>
      )}
      <form method="get" className="filter-bar" role="search">
        <label>Search by account name<input name="q" defaultValue={q ?? ""} maxLength={80} /></label>
        <button className="btn" type="submit">Search</button>
      </form>
      <AccountsTable rows={rows} />
    </div>
  );
}
