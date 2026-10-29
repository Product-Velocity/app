import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { atlassianConfig, buildAuthorizeUrl, CONFLUENCE_SCOPES, JIRA_SCOPES } from "@/lib/atlassian/oauth";
import { createClient } from "@/lib/supabase/server";

// THROWAWAY (spike J1, #257). Admin-only start of the Atlassian consent; the state is bound to this browser by a cookie.
export async function GET(request: NextRequest) {
  const cfg = atlassianConfig();
  const back = (s: string) => NextResponse.redirect(new URL(`/spikes/atlassian?status=${s}`, request.url));
  if (!cfg) return back("not-configured");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL("/sign-in?next=/spikes/atlassian", request.url));
  const state = randomBytes(24).toString("base64url");
  const scopes = request.nextUrl.searchParams.get("confluence") === "1" ? [...JIRA_SCOPES, ...CONFLUENCE_SCOPES] : JIRA_SCOPES;
  const res = NextResponse.redirect(buildAuthorizeUrl(cfg, scopes, `${auth.user.id}.${state}`));
  res.cookies.set("atl_state", `${auth.user.id}.${state}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/atlassian", maxAge: 600 });
  return res;
}
