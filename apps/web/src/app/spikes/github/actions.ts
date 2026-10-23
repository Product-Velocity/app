"use server";
// THROWAWAY spike actions for issue #30. Admin-only; every call is limited to the sandbox by isSandboxPath.
import { requireWorkspace } from "@/lib/session";
import { gh, installationAccessToken, SANDBOX_ORG, SANDBOX_REPO, type CallResult } from "@/lib/spikes/github-app";

export type SpikeOutput = { title: string; steps: { label: string; result: CallResult | { error: string } }[] };

async function guard() {
  const { active } = await requireWorkspace("/spikes/github");
  if (active.role !== "admin") throw new Error("Admins only");
}

async function step(label: string, fn: () => Promise<CallResult>) {
  try {
    return { label, result: await fn() };
  } catch (e) {
    return { label, result: { error: e instanceof Error ? e.message : String(e) } };
  }
}

const repo = `/repos/${SANDBOX_ORG}/${SANDBOX_REPO}`;
const bodyOf = (r: CallResult | { error: string }) => ("body" in r ? (r.body as Record<string, unknown>) : {});

export async function checkConnection(): Promise<SpikeOutput> {
  await guard();
  return {
    title: "Connection: App, installations, repository",
    steps: [
      await step("GET /app (App JWT)", () => gh("app", "GET", "/app")),
      await step("GET /app/installations (App JWT)", () => gh("app", "GET", "/app/installations")),
      await step("GET repository (installation token)", () => gh("installation", "GET", repo)),
      await step("GET org issue types (Epic?)", () => gh("installation", "GET", `/orgs/${SANDBOX_ORG}/issue-types`)),
    ],
  };
}

/** S4b: three levels of sub-issues, then the numeric-id call and the limits we can see. */
export async function runS4b(): Promise<SpikeOutput> {
  await guard();
  const token = await installationAccessToken();
  const steps: SpikeOutput["steps"] = [];
  const made: { number: number; id: number }[] = [];
  for (const level of ["L1 parent", "L2 child", "L3 grandchild"]) {
    const s = await step(`create issue ${level}`, () =>
      gh("installation", "POST", `${repo}/issues`, { title: `[spike S4b] ${level}` }, token),
    );
    steps.push(s);
    const b = bodyOf(s.result);
    if (typeof b.id === "number" && typeof b.number === "number") made.push({ number: b.number, id: b.id });
  }
  if (made.length === 3) {
    steps.push(
      await step("link L2 under L1 (sub_issue_id = numeric id)", () =>
        gh("installation", "POST", `${repo}/issues/${made[0]!.number}/sub_issues`, { sub_issue_id: made[1]!.id }, token),
      ),
      await step("link L3 under L2", () =>
        gh("installation", "POST", `${repo}/issues/${made[1]!.number}/sub_issues`, { sub_issue_id: made[2]!.id }, token),
      ),
      await step("list sub-issues of L1", () => gh("installation", "GET", `${repo}/issues/${made[0]!.number}/sub_issues`, undefined, token)),
      await step("GET L1 (sub_issues_summary)", () => gh("installation", "GET", `${repo}/issues/${made[0]!.number}`, undefined, token)),
    );
  }
  return { title: "S4b: three levels of sub-issues", steps };
}

/** S2b: read org Projects v2 as the App, find "Spike Project", add the S4b parent issue if any. */
export async function runS2b(): Promise<SpikeOutput> {
  await guard();
  const token = await installationAccessToken();
  const q = `query($org:String!){organization(login:$org){projectsV2(first:20){nodes{id number title public closed
    fields(first:30){nodes{... on ProjectV2Field{id name dataType} ... on ProjectV2SingleSelectField{id name dataType} ... on ProjectV2IterationField{id name dataType}}}}}}}`;
  const list = await step("GraphQL: list org projects and fields", () =>
    gh("installation", "POST", "/graphql", { query: q, variables: { org: SANDBOX_ORG } }, token),
  );
  const steps: SpikeOutput["steps"] = [list];
  const data = bodyOf(list.result).data as { organization?: { projectsV2?: { nodes?: { id: string; title: string }[] } } } | undefined;
  const project = data?.organization?.projectsV2?.nodes?.find((p) => p.title === "Spike Project");
  if (!project) {
    steps.push({ label: "Find 'Spike Project'", result: { error: "Not visible to the App (private project, or Projects permission missing)" } });
    return { title: "S2b: organisation Projects v2", steps };
  }
  const issues = await step("find an open spike issue", () =>
    gh("installation", "GET", `${repo}/issues?state=open&per_page=1&direction=asc`, undefined, token),
  );
  const open = (issues.result as CallResult).body as { node_id?: string; number?: number }[] | undefined;
  const node = Array.isArray(open) ? open[0]?.node_id : undefined;
  steps.push(issues);
  if (node) {
    steps.push(
      await step("GraphQL: add issue to Spike Project", () =>
        gh("installation", "POST", "/graphql", {
          query: `mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}`,
          variables: { p: project.id, c: node },
        }, token),
      ),
      await step("GraphQL: read project items back", () =>
        gh("installation", "POST", "/graphql", {
          query: `query($p:ID!){node(id:$p){... on ProjectV2{items(first:20){nodes{id content{... on Issue{number title}}}}}}}`,
          variables: { p: project.id },
        }, token),
      ),
    );
  }
  return { title: "S2b: organisation Projects v2", steps };
}

export async function webhookDeliveries(): Promise<SpikeOutput> {
  await guard();
  return {
    title: "Recent webhook deliveries (GitHub keeps these for 3 days)",
    steps: [await step("GET /app/hook/deliveries", () => gh("app", "GET", "/app/hook/deliveries?per_page=30"))],
  };
}

/** Free-form probe for S3b (issue fields) and anything else; the path is still limited to the sandbox. */
export async function probe(_prev: SpikeOutput | null, form: FormData): Promise<SpikeOutput> {
  await guard();
  const method = String(form.get("method") ?? "GET").toUpperCase();
  if (!["GET", "POST", "PATCH", "PUT"].includes(method)) throw new Error("Method not allowed");
  const path = String(form.get("path") ?? "");
  const raw = String(form.get("body") ?? "").trim();
  let body: unknown;
  if (raw) body = JSON.parse(raw);
  const auth = form.get("auth") === "app" ? "app" : "installation";
  return { title: `Probe ${method} ${path}`, steps: [await step(`${auth} token`, () => gh(auth, method, path, body))] };
}
