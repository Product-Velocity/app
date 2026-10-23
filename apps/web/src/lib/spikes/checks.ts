// THROWAWAY spike code for issue #30: the automated checks behind /spikes/github.
import "server-only";
import { gh, installationAccessToken, SANDBOX_ORG, SANDBOX_REPO, type CallResult } from "./github-app";
import { CHECKS, compact, fixFor, permissionGaps, summariseDeliveries, type CheckResult, type Delivery } from "./checks-shared";

const repo = `/repos/${SANDBOX_ORG}/${SANDBOX_REPO}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const msg = (r: CallResult) => (r.body as { message?: string } | null)?.message;
const fixOf = (r: CallResult) => fixFor(r.status, msg(r), r.headers["x-accepted-github-permissions"]);

type Out = Omit<CheckResult, "id" | "title">;
type Issue = { number: number; id: number; node_id: string; title: string };

async function createIssue(token: string, title: string) {
  const r = await gh("installation", "POST", `${repo}/issues`, { title }, token);
  return { r, issue: r.ok ? (r.body as Issue) : undefined };
}

/** Keeps the sandbox tidy: closes spike issues left open by earlier runs. */
async function closeOldSpikeIssues(token: string): Promise<number> {
  const list = await gh("installation", "GET", `${repo}/issues?state=open&per_page=100`, undefined, token);
  const open = Array.isArray(list.body) ? (list.body as Issue[]) : [];
  let closed = 0;
  for (const i of open.filter((x) => x.title.startsWith("[spike"))) {
    await gh("installation", "PATCH", `${repo}/issues/${i.number}`, { state: "closed", state_reason: "not_planned" }, token);
    closed++;
  }
  return closed;
}

async function gql<T>(token: string, query: string, variables?: Record<string, unknown>) {
  const r = await gh("installation", "POST", "/graphql", { query, variables }, token);
  const body = r.body as { data?: T; errors?: { message: string }[] } | null;
  const error = !r.ok ? fixOf(r) : body?.errors?.map((e) => e.message).join("; ");
  return { data: body?.data, error: error || undefined, status: r.status };
}

async function connection(): Promise<Out> {
  const app = await gh("app", "GET", "/app");
  if (!app.ok) return { verdict: "fail", summary: `GET /app returned ${app.status}.`, fix: fixOf(app), evidence: compact(app.body) };
  const inst = await gh("app", "GET", "/app/installations");
  const list = Array.isArray(inst.body)
    ? (inst.body as { id: number; account?: { login?: string }; permissions?: Record<string, string>; events?: string[]; repository_selection?: string }[])
    : [];
  const mine = list.find((i) => i.account?.login?.toLowerCase() === SANDBOX_ORG.toLowerCase());
  const appInfo = app.body as { slug?: string; permissions?: Record<string, string>; events?: string[] };
  if (!mine) {
    return { verdict: "fail", summary: `The App is not installed on ${SANDBOX_ORG}.`, fix: "Install it: the App's page on GitHub > Install App > the org > Only select repositories > Test-Repo-01.", evidence: { installations: list.length } };
  }
  if (mine.repository_selection === "all") {
    return {
      verdict: "fail",
      summary: `The App is installed on ALL repositories of ${SANDBOX_ORG}, including ${SANDBOX_ORG}/app. The sandbox rule is ${SANDBOX_REPO} only.`,
      fix: `Open https://github.com/organizations/${SANDBOX_ORG}/settings/installations/${mine.id}, under Repository access choose "Only select repositories", select ${SANDBOX_REPO}, and save.`,
      evidence: { installedOn: list.map((i) => `${i.account?.login} (${i.repository_selection})`) },
    };
  }
  const elsewhere = list.filter((i) => i !== mine);
  if (elsewhere.length) {
    return {
      verdict: "fail",
      summary: `The App is also installed outside the sandbox org: ${elsewhere.map((i) => `${i.account?.login} (${i.repository_selection})`).join(", ")}. That gives it access to unrelated repositories.`,
      fix: "On GitHub, sign in as that account, go to Settings > Applications > Installed GitHub Apps > Product Velocity Sandbox > Configure, and uninstall it. Then retry the non-owner request with the Product-Velocity organisation as the target.",
      evidence: { installedOn: list.map((i) => `${i.account?.login} (${i.repository_selection})`) },
    };
  }
  const gaps = permissionGaps(mine.permissions, { issues: "write", organization_projects: "write", issue_types: "read" });
  const missingEvents = ["issues", "projects_v2_item"].filter((e) => !mine.events?.includes(e));
  const pendingPerms = permissionGaps(appInfo.permissions, { issues: "write" }).length === 0 && gaps.length > 0;
  const evidence = compact({ app: appInfo.slug, appPermissions: appInfo.permissions, installationPermissions: mine.permissions, installationEvents: mine.events, repositorySelection: mine.repository_selection, installedOn: list.map((i) => `${i.account?.login} (${i.repository_selection})`) });
  if (gaps.length || missingEvents.length) {
    return {
      verdict: "fail",
      summary: `Installation is missing: ${[...gaps, ...missingEvents.map((e) => `event ${e}`)].join("; ")}.`,
      fix: pendingPerms
        ? `The App asks for these but an org owner has not accepted them: open https://github.com/organizations/${SANDBOX_ORG}/settings/installations/${mine.id} and accept the updated permissions.`
        : "Add them in the App's settings (Permissions & events / Subscribe to events), save, then accept the update on the installation page as an org owner.",
      evidence,
    };
  }
  return { verdict: "pass", summary: "Credentials work, the App is installed on the org (selected repositories) with the permissions and events these spikes need.", evidence };
}

async function issueTypes(token: string): Promise<Out> {
  const r = await gh("installation", "GET", `/orgs/${SANDBOX_ORG}/issue-types`, undefined, token);
  if (!r.ok) return { verdict: "fail", summary: `Issue types request returned ${r.status}.`, fix: fixOf(r), evidence: compact(r.body) };
  const names = (Array.isArray(r.body) ? (r.body as { name: string }[]) : []).map((t) => t.name);
  const epic = names.some((n) => n.toLowerCase() === "epic");
  return {
    verdict: "pass",
    summary: `Issue types on this org (Free plan): ${names.join(", ") || "none"}. Epic is ${epic ? "available" : "NOT available, so the sync needs a label fallback or an admin-created type"}.`,
    evidence: names,
  };
}

async function s4b(token: string): Promise<Out> {
  const closed = await closeOldSpikeIssues(token);
  const DEPTH = 9;
  const made: Issue[] = [];
  for (let i = 1; i <= DEPTH; i++) {
    const { r, issue } = await createIssue(token, `[spike S4b] level ${i}`);
    if (!issue) return { verdict: "fail", summary: `Could not create issue for level ${i} (${r.status}).`, fix: fixOf(r), evidence: compact(r.body) };
    made.push(issue);
  }
  let linked = 0;
  let refusal: { level: number; status: number; message?: string } | undefined;
  for (let i = 1; i < made.length; i++) {
    const r = await gh("installation", "POST", `${repo}/issues/${made[i - 1]!.number}/sub_issues`, { sub_issue_id: made[i]!.id }, token);
    if (!r.ok) {
      refusal = { level: i + 1, status: r.status, message: msg(r) };
      break;
    }
    linked++;
  }
  const levels = linked + 1;
  const top = await gh("installation", "GET", `${repo}/issues/${made[0]!.number}`, undefined, token);
  const summary = (top.body as { sub_issues_summary?: unknown } | null)?.sub_issues_summary;
  const evidence = { closedOldIssues: closed, levelsLinked: levels, testedUpTo: DEPTH, refusal, topLevelSubIssuesSummary: summary, note: "100-children-per-parent limit not tested (would need 101 issues)" };
  if (levels < 3) {
    return { verdict: "fail", summary: `Only ${levels} level(s) could be linked.`, fix: refusal ? fixFor(refusal.status, refusal.message) : "See evidence.", evidence };
  }
  return {
    verdict: "pass",
    summary: refusal
      ? `Sub-issues work through ${levels} levels using the numeric issue id; GitHub refused level ${refusal.level} (${refusal.status} ${refusal.message ?? ""}), so the depth limit is ${levels}.`
      : `Sub-issues linked through all ${levels} tested levels using the numeric issue id (sub_issue_id). No depth limit hit up to ${DEPTH}.`,
    evidence,
  };
}

type Project = { id: string; number: number; title: string; public: boolean; closed: boolean; fields: { nodes: { id?: string; name?: string; dataType?: string }[] } };

async function s2b(token: string): Promise<Out> {
  const trail: string[] = [];
  const list = await gql<{ organization?: { projectsV2?: { nodes?: Project[] } } }>(
    token,
    `query($org:String!){organization(login:$org){projectsV2(first:20){nodes{id number title public closed fields(first:50){nodes{... on ProjectV2Field{id name dataType}}}}}}}`,
    { org: SANDBOX_ORG },
  );
  if (list.error) return { verdict: "fail", summary: "Could not list organisation projects.", fix: list.error, evidence: trail };
  const project = list.data?.organization?.projectsV2?.nodes?.find((p) => p.title === "Spike Project" && !p.closed);
  if (!project) {
    return { verdict: "fail", summary: "The App cannot see an open organisation project called 'Spike Project'.", fix: "Check the project exists in the org with exactly that name and is open. If it does, the installation is missing the Organization 'Projects' permission.", evidence: list.data };
  }
  trail.push(`Found project #${project.number} (${project.public ? "public" : "private"}); visible to the App.`);

  const fieldIds: Record<string, string> = {};
  for (const name of ["Start date", "Target date"]) {
    const existing = project.fields.nodes.find((f) => f.name === name && f.dataType === "DATE");
    if (existing?.id) {
      fieldIds[name] = existing.id;
      trail.push(`${name}: already exists.`);
      continue;
    }
    const made = await gql<{ createProjectV2Field?: { projectV2Field?: { id: string } } }>(
      token,
      `mutation($p:ID!,$n:String!){createProjectV2Field(input:{projectId:$p,dataType:DATE,name:$n}){projectV2Field{... on ProjectV2Field{id}}}}`,
      { p: project.id, n: name },
    );
    const id = made.data?.createProjectV2Field?.projectV2Field?.id;
    if (!id) return { verdict: "fail", summary: `Could not create the '${name}' date field.`, fix: made.error ?? "See evidence.", evidence: trail };
    fieldIds[name] = id;
    trail.push(`${name}: created by the App.`);
  }

  const { r, issue } = await createIssue(token, "[spike S2b] project item");
  if (!issue) return { verdict: "fail", summary: "Could not create the test issue.", fix: fixOf(r), evidence: trail };
  const added = await gql<{ addProjectV2ItemById?: { item?: { id: string } } }>(
    token,
    `mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}`,
    { p: project.id, c: issue.node_id },
  );
  const itemId = added.data?.addProjectV2ItemById?.item?.id;
  if (!itemId) return { verdict: "fail", summary: "The App could not add an issue to the project.", fix: added.error ?? "See evidence.", evidence: trail };
  trail.push("Added an issue to the project.");

  const dates = { "Start date": "2026-11-01", "Target date": "2026-12-15" };
  for (const [name, date] of Object.entries(dates)) {
    const w = await gql(
      token,
      `mutation($p:ID!,$i:ID!,$f:ID!,$d:Date!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{date:$d}}){projectV2Item{id}}}`,
      { p: project.id, i: itemId, f: fieldIds[name], d: date },
    );
    if (w.error) return { verdict: "fail", summary: `Writing '${name}' failed.`, fix: w.error, evidence: trail };
  }
  trail.push("Wrote Start date and Target date.");

  let attempts = 0;
  let found: Record<string, string> = {};
  let itemSeen = false;
  for (; attempts < 8; attempts++) {
    await sleep(1500);
    const back = await gql<{ node?: { items?: { nodes?: { id: string; fieldValues?: { nodes?: { date?: string; field?: { name?: string } }[] } }[] } } }>(
      token,
      `query($p:ID!){node(id:$p){... on ProjectV2{items(first:100){nodes{id fieldValues(first:30){nodes{... on ProjectV2ItemFieldDateValue{date field{... on ProjectV2Field{name}}}}}}}}}}`,
      { p: project.id },
    );
    const item = back.data?.node?.items?.nodes?.find((n) => n.id === itemId);
    itemSeen = Boolean(item);
    found = Object.fromEntries((item?.fieldValues?.nodes ?? []).filter((v) => v.date && v.field?.name).map((v) => [v.field!.name!, v.date!]));
    if (found["Start date"] === dates["Start date"] && found["Target date"] === dates["Target date"]) break;
  }
  const ok = found["Start date"] === dates["Start date"] && found["Target date"] === dates["Target date"];
  trail.push(`Read back after ${attempts + 1} attempt(s) (1.5 s apart): item ${itemSeen ? "visible" : "NOT visible"}, values ${JSON.stringify(found)}.`);
  return ok
    ? { verdict: "pass", summary: `The App can read a private organisation project, add items, create date fields and write and read back date values. Reads right after a write may lag (took ${attempts + 1} attempt(s)).`, evidence: trail }
    : { verdict: "fail", summary: "Dates were written but did not read back in time.", fix: itemSeen ? "Values may lag more than 12 s; re-run once. If it repeats, the App cannot read date values in this project." : "The item never appeared on read, which matches the report that Apps cannot read items in private projects; make the project public or use issue fields as the fallback.", evidence: trail };
}

async function s3b(token: string): Promise<Out> {
  const { r, issue } = await createIssue(token, "[spike S3b] issue fields");
  if (!issue) return { verdict: "fail", summary: "Could not create the test issue.", fix: fixOf(r) };
  const probes: Record<string, unknown> = {};
  const orgFields = await gh("installation", "GET", `/orgs/${SANDBOX_ORG}/issue-fields`, undefined, token);
  probes["GET /orgs/{org}/issue-fields"] = { status: orgFields.status, permissionGitHubNames: orgFields.headers["x-accepted-github-permissions"], body: compact(orgFields.body) };
  const values = await gh("installation", "GET", `${repo}/issues/${issue.number}/issue-field-values`, undefined, token);
  probes["GET /repos/.../issues/{n}/issue-field-values"] = { status: values.status, permissionGitHubNames: values.headers["x-accepted-github-permissions"], body: compact(values.body) };
  const g = await gql(token, `query($org:String!){organization(login:$org){issueFields(first:20){nodes{__typename}}}}`, { org: SANDBOX_ORG });
  probes["GraphQL organization.issueFields"] = { status: g.status, error: g.error, data: g.data };
  const issueGet = await gh("installation", "GET", `${repo}/issues/${issue.number}`, undefined, token);
  probes["issue payload has issue_field_values"] = "issue_field_values" in ((issueGet.body as object) ?? {});
  const statuses = [orgFields.status, values.status, g.status].join(", ");
  return {
    verdict: "info",
    summary: `Discovery only (statuses ${statuses}). Writing issue-field values is not attempted automatically because the endpoint shapes are unverified; send this report to Claude to choose the next calls.`,
    fix: orgFields.ok || values.ok ? undefined : "If these are 404 the org has no issue fields on the Free plan; Projects v2 date fields (S2b) are then the only date path.",
    evidence: probes,
  };
}

async function webhooks(): Promise<Out> {
  const r = await gh("app", "GET", "/app/hook/deliveries?per_page=100");
  if (!r.ok) return { verdict: "fail", summary: `Could not list deliveries (${r.status}).`, fix: fixOf(r), evidence: compact(r.body) };
  const list = Array.isArray(r.body) ? (r.body as Delivery[]) : [];
  const counts = summariseDeliveries(list);
  // Deliveries come newest first. Only the latest 20 decide the verdict: an old failure (for example a ping sent
  // before the route was deployed) must not hide that everything since then works.
  const recent = list.slice(0, 20);
  const good = recent.filter((d) => (d.status_code ?? 0) >= 200 && (d.status_code ?? 0) < 300).length;
  const unauthorised = recent.filter((d) => d.status_code === 401).length;
  const bad = recent.filter((d) => (d.status_code ?? 0) >= 400 && d.status_code !== 401);
  const evidence = { allDeliveries: counts, latestTwenty: summariseDeliveries(recent) };
  if (list.length === 0) {
    return { verdict: "fail", summary: "GitHub has sent no webhook deliveries yet.", fix: "In the App's settings, tick Webhook > Active and set the Webhook URL to https://productvelocity.app/api/spikes/github-webhook, then re-run the other checks (they generate events).", evidence };
  }
  if (unauthorised) {
    return { verdict: "fail", summary: `${unauthorised} of the latest ${recent.length} deliveries were rejected with 401 (signature mismatch).`, fix: "The webhook secret in Vercel (GITHUB_APP_WEBHOOK_SECRET) differs from the App's. Make them identical, redeploy, then use 'Redeliver' on a delivery in the App's Advanced tab.", evidence };
  }
  if (bad.length) {
    return { verdict: "fail", summary: `${bad.length} of the latest ${recent.length} deliveries got an error status.`, fix: "404 means the URL is wrong; 5xx means the route crashed (see Vercel logs).", evidence };
  }
  const old = list.slice(20).filter((d) => (d.status_code ?? 0) >= 400).length;
  return {
    verdict: good ? "pass" : "fail",
    summary: `${good} of the latest ${recent.length} deliveries were accepted (2xx)${old ? `; ${old} older delivery(ies) failed, probably from before the route was deployed` : ""}.`,
    evidence,
  };
}

async function s5b(): Promise<Out> {
  const r = await gh("app", "GET", "/app/hook/deliveries?per_page=15");
  const recent = (Array.isArray(r.body) ? (r.body as Delivery[]) : []).map((d) => `${d.delivered_at} ${d.event}/${d.action ?? "-"} ${d.status_code}`);
  return {
    verdict: "manual",
    summary: "Needs a person. As dev-nbm (a non-owner member) in a separate browser profile: open the App's page on GitHub (https://github.com/apps/product-velocity-sandbox), click Install, choose the org, and request approval. Then, as an org owner, approve (or reject) the request. Re-run this suite afterwards: the recent deliveries below show which webhook events arrived at request and at approval.",
    evidence: recent,
  };
}

export async function runCheckById(id: string): Promise<CheckResult> {
  const meta = CHECKS.find((c) => c.id === id);
  if (!meta) throw new Error("Unknown check");
  try {
    const needsToken = id !== "connection" && id !== "webhooks" && id !== "s5b";
    const token = needsToken ? await installationAccessToken() : "";
    const out =
      id === "connection" ? await connection()
      : id === "issue-types" ? await issueTypes(token)
      : id === "s4b" ? await s4b(token)
      : id === "s2b" ? await s2b(token)
      : id === "s3b" ? await s3b(token)
      : id === "webhooks" ? await webhooks()
      : await s5b();
    return { id, title: meta.title, ...out };
  } catch (e) {
    return { id, title: meta.title, verdict: "fail", summary: `The check crashed: ${e instanceof Error ? e.message : String(e)}`, fix: "If this mentions the installation or a token, run 'App credentials' first and fix that." };
  }
}
