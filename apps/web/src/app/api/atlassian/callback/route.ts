import { NextResponse, type NextRequest } from "next/server";
import { buildFieldCatalog, hierarchyLevels, proposeInitiativeLevel, type JiraField, type JiraIssueSample, type JiraIssueType } from "@/lib/atlassian/field-catalog";
import { API_BASE, atlassianConfig, exchangeCode } from "@/lib/atlassian/oauth";
import { createClient } from "@/lib/supabase/server";

// THROWAWAY (spike J1, #257). Exchanges the code, runs read-only probes and prints what Atlassian answered.
// Nothing is stored: tokens live in this request only, and are never printed.
export const maxDuration = 60;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

async function getJson<T>(token: string, url: string): Promise<{ status: number; data: T | null }> {
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    return { status: res.status, data: res.ok ? ((await res.json()) as T) : null };
  } catch {
    return { status: 0, data: null };
  }
}

async function projects(token: string, jira: string) {
  const r = await getJson<{ total?: number; isLast?: boolean; values: { key: string; projectTypeKey: string; style?: string }[] }>(token, `${jira}/project/search?maxResults=50`);
  const body = r.data ? `total ${r.data.total}, isLast ${String(r.data.isLast)}\n` + r.data.values.map((v) => `${v.key} | ${v.projectTypeKey} | ${v.style ?? "-"}`).join("\n") : "no answer";
  return { label: "Projects (key | type | style)", status: r.status, body };
}

/** Only what the spike needs to know; no email, name, account id or avatar is printed. */
async function whoAmI(token: string, jira: string) {
  const me = await getJson<{ accountType?: string; active?: boolean; timeZone?: string; emailAddress?: string }>(token, `${jira}/myself`);
  const d = me.data;
  const body = d ? `account type: ${d.accountType}\nactive: ${String(d.active)}\ntime zone: ${d.timeZone}\nemail returned: ${d.emailAddress ? "yes" : "no"}` : "no answer";
  return { label: "Who am I", status: me.status, body };
}

/** Spike J2: the field catalog, the hierarchy levels, the status categories and how a sample search pages. */
async function catalogProbe(token: string, jira: string) {
  const [types, fields, statuses, search] = await Promise.all([
    getJson<JiraIssueType[]>(token, `${jira}/issuetype`),
    getJson<JiraField[]>(token, `${jira}/field`),
    getJson<{ name: string; statusCategory?: { name: string } }[]>(token, `${jira}/status`),
    getJson<{ issues: JiraIssueSample[]; nextPageToken?: string; isLast?: boolean }>(
      token,
      `${jira}/search/jql?jql=${encodeURIComponent("created >= -3650d order by created DESC")}&maxResults=100&fields=*all`,
    ),
  ]);
  const lines: string[] = [`issuetype ${types.status} · field ${fields.status} · status ${statuses.status} · search ${search.status}`];
  if (types.data) {
    const levels = hierarchyLevels(types.data);
    lines.push("", "Hierarchy levels (1 = Epic, 0 = Story/Task/Bug, -1 = Sub-task, 2+ = above Epic):", ...levels.map((l) => `  ${l.level}: ${l.types.join(", ")}`));
    const proposal = proposeInitiativeLevel(levels);
    lines.push(`Initiative proposal: ${proposal.types.join(", ")} (${proposal.source})`);
  }
  if (statuses.data) {
    const byCat = new Map<string, number>();
    for (const st of statuses.data) byCat.set(st.statusCategory?.name ?? "?", (byCat.get(st.statusCategory?.name ?? "?") ?? 0) + 1);
    lines.push("", `Statuses by category: ${[...byCat].map(([k, n]) => `${k} ${n}`).join(", ")}`);
  }
  if (search.data) lines.push("", `Sample: ${search.data.issues.length} issues, isLast=${String(search.data.isLast)}, nextPageToken=${search.data.nextPageToken ? "yes" : "no"}`);
  if (fields.data) {
    const rows = buildFieldCatalog(fields.data, search.data?.issues ?? []);
    lines.push("", `Fields: ${rows.length} (${rows.filter((r) => r.custom).length} custom). id | name | custom | kind | role | filled/sampled`);
    for (const r of rows) lines.push(`  ${r.id} | ${r.name} | ${r.custom ? "custom" : "system"} | ${r.kind} | ${r.role ?? "-"} | ${r.filled}/${r.sampled}`);
  }
  return { label: "Field catalog, hierarchy and paging (J2)", status: fields.status, body: lines.join("\n") };
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
  const sites = await getJson<{ id: string; scopes: string[] }[]>(token.access_token, `${API_BASE}/oauth/token/accessible-resources`);
  results.push({ label: "Accessible sites", status: sites.status, body: (sites.data ?? []).map((x, i) => `site ${i + 1}: scopes ${x.scopes.join(", ")}`).join("\n") || "none" });
  const cloudId = sites.data?.[0]?.id ?? "";
  if (cloudId) {
    const jira = `${API_BASE}/ex/jira/${cloudId}/rest/api/3`;
    results.push(await whoAmI(token.access_token, jira));
    results.push(await projects(token.access_token, jira));
    results.push(await catalogProbe(token.access_token, jira));
  }
  const html = results.map((r) => `<h3>${esc(r.label)} <small>(${r.status})</small></h3><pre style="white-space:pre-wrap;background:#f4f4f6;padding:8px">${esc(r.body)}</pre>`).join("");
  const res = page(html);
  res.cookies.delete("atl_state");
  return res;
}
