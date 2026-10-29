import { NextResponse, type NextRequest } from "next/server";
import { API_BASE, atlassianConfig, exchangeCode } from "@/lib/atlassian/oauth";
import { createClient } from "@/lib/supabase/server";

// THROWAWAY (spike J1, #257). Exchanges the code, runs read-only probes and prints what Atlassian answered.
// Nothing is stored: tokens live in this request only, and are never printed.
export const maxDuration = 60;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

async function probe(token: string, label: string, url: string) {
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    const text = await res.text();
    return { label, status: res.status, body: text.slice(0, 1500) };
  } catch (e) {
    return { label, status: 0, body: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const page = (body: string, status = 200) =>
    new NextResponse(`<!doctype html><meta charset="utf-8"><title>Atlassian spike</title><body style="font:14px system-ui;padding:24px;max-width:960px"><h1>Atlassian spike J1</h1>${body}<p><a href="/spikes/atlassian">Back</a></p>`, { status, headers: { "content-type": "text/html; charset=utf-8" } });

  const cfg = atlassianConfig();
  if (!cfg) return page("<p>Not configured.</p>", 500);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL("/sign-in?next=/spikes/atlassian", request.url));

  const state = url.searchParams.get("state");
  const cookie = request.cookies.get("atl_state")?.value;
  if (!state || !cookie || state !== cookie || !state.startsWith(`${auth.user.id}.`)) return page("<p>The link is not valid for this browser. Start again.</p>", 400);
  const code = url.searchParams.get("code");
  if (!code) return page(`<p>Atlassian answered: ${esc(url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? "no code")}</p>`, 400);

  let token;
  try {
    token = await exchangeCode(cfg, code);
  } catch (e) {
    return page(`<p>${esc(e instanceof Error ? e.message : "Token exchange failed")}</p>`, 502);
  }
  const results = [{ label: "Token", status: 200, body: `scopes granted: ${token.scope}\nrefresh token: ${token.refresh_token ? "yes" : "NO"}\nexpires in: ${token.expires_in}s` }];
  const sites = await probe(token.access_token, "Accessible sites", `${API_BASE}/oauth/token/accessible-resources`);
  results.push(sites);
  let cloudId = "";
  try {
    cloudId = (JSON.parse(sites.body) as { id: string }[])[0]?.id ?? "";
  } catch {
    /* the body is shown anyway */
  }
  if (cloudId) {
    const jira = `${API_BASE}/ex/jira/${cloudId}/rest/api/3`;
    results.push(await probe(token.access_token, "Who am I", `${jira}/myself`));
    results.push(await probe(token.access_token, "Projects", `${jira}/project/search?maxResults=5`));
    results.push(await probe(token.access_token, "Issue types", `${jira}/issuetype`));
    results.push(await probe(token.access_token, "Fields (field catalog, J2)", `${jira}/field`));
    results.push(await probe(token.access_token, "Recent issues", `${jira}/search/jql?jql=${encodeURIComponent("order by created DESC")}&maxResults=3&fields=summary,issuetype,status`));
  }
  const html = results.map((r) => `<h3>${esc(r.label)} <small>(${r.status})</small></h3><pre style="white-space:pre-wrap;background:#f4f4f6;padding:8px">${esc(r.body)}</pre>`).join("");
  const res = page(html);
  res.cookies.delete("atl_state");
  return res;
}
