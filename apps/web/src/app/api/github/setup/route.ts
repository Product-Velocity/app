import { NextResponse, type NextRequest } from "next/server";
import { verifyInstallState } from "@pv/github";
import { githubSecret, githubSourceControl, type ConnectionRow } from "@/lib/github/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const PAGE = "/settings/integrations/github";

/**
 * GitHub sends the browser here after "Install" (setup_action=install or update) or after a non-owner asked for
 * approval (setup_action=request, no installation id). The signed `state` ties it to one admin, workspace and
 * connection. This only records that the install happened; the connection becomes "connected" when GitHub's
 * installation webhook arrives.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const back = (status: string) => NextResponse.redirect(new URL(`${PAGE}?status=${status}`, request.url));

  const secret = githubSecret();
  const state = verifyInstallState(url.searchParams.get("state"), secret ?? "");
  if (!secret || !state) return back("bad-link");

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL(`/sign-in?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`, request.url));
  if (auth.user.id !== state.userId) return back("bad-link");

  const { data: member } = await supabase.from("tenant_members").select("role, is_service_account").eq("tenant_id", state.tenantId).eq("user_id", auth.user.id).maybeSingle();
  if (!member || member.role !== "admin" || member.is_service_account) return back("not-admin");

  const { data: row } = await supabase.from("github_connections").select("*").eq("id", state.connectionId).eq("tenant_id", state.tenantId).maybeSingle();
  const conn = row as ConnectionRow | null;
  if (!conn || conn.state === "disconnected") return back("bad-link");

  const admin = createAdminClient({ via: "UI" });
  const action = url.searchParams.get("setup_action");
  if (action === "request") {
    if (conn.state === "requested") await admin.from("github_connections").update({ state: "waiting_approval" }).eq("id", conn.id);
    return back("waiting");
  }

  const installationId = Number(url.searchParams.get("installation_id"));
  const sc = githubSourceControl();
  if (!sc || !Number.isSafeInteger(installationId) || installationId <= 0) return back("bad-link");
  const installation = await sc.getInstallation(installationId).catch(() => null);
  if (!installation) return back("not-found");
  if (installation.accountLogin.toLowerCase() !== conn.expected_account.toLowerCase()) return back("wrong-account");

  const next = conn.state === "connected" ? "connected" : "installing";
  const { error } = await admin
    .from("github_connections")
    .update({ installation_id: installation.id, account_login: installation.accountLogin, account_type: installation.accountType, repository_selection: installation.repositorySelection, state: next })
    .eq("id", conn.id);
  if (error) return back(error.code === "23505" ? "already-linked" : "error");
  return back(next === "connected" ? "connected" : "installed");
}
