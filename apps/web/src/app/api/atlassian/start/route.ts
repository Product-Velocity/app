import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { atlassianConfig, buildAuthorizeUrl, CONFLUENCE_SCOPES, JIRA_SCOPES } from "@/lib/atlassian/oauth";
import { isWorkspaceAdmin } from "@/lib/atlassian/guard";
import { createClient } from "@/lib/supabase/server";

// THROWAWAY (spike J1/J4, #257). Admin-only start of the Atlassian consent; the state is bound to this browser by a cookie.
export async function GET(request: NextRequest) {
  const cfg = atlassianConfig();
  const back = (s: string) => NextResponse.redirect(new URL(`/spikes/atlassian?status=${s}`, request.url));
  if (!cfg) return back("not-configured");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL("/sign-in?next=/spikes/atlassian", request.url));
  if (!(await isWorkspaceAdmin(supabase, auth.user.id))) return back("admins-only");
  const state = randomBytes(24).toString("base64url");
  const mode = request.nextUrl.searchParams.get("mode") ?? "read";
  const probe = ["paging", "devinfo", "idea", "idea-link", "webhook"].includes(mode) ? mode : null;
  // an argument for the probe (project or issue key); validated again in the callback
  const arg = (request.nextUrl.searchParams.get("arg") ?? "").slice(0, 40);
  const base = request.nextUrl.searchParams.get("confluence") === "1" ? [...JIRA_SCOPES, ...CONFLUENCE_SCOPES] : JIRA_SCOPES;
  const scopes = probe === "webhook" ? [...base, "manage:jira-webhook"] : base; // webhook registration is its own scope (spike J3)
  const res = NextResponse.redirect(buildAuthorizeUrl(cfg, scopes, `${auth.user.id}.${state}`));
  res.cookies.set("atl_mode", probe ?? (mode === "write" ? "write" : "read"), { httpOnly: true, secure: true, sameSite: "lax", path: "/api/atlassian", maxAge: 600 });
  res.cookies.set("atl_arg", arg, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/atlassian", maxAge: 600 });
  res.cookies.set("atl_state", `${auth.user.id}.${state}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/atlassian", maxAge: 600 });
  return res;
}
