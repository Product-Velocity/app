import { createSign } from "node:crypto";
import type { PrRef, ReleaseRef } from "./delivery";
import { GitHubError, type BoardItemStatus, type BoardItemValue, type BoardField, type BoardInfo, type BoardValue, type IssueSummary, type DeliverySummary, type InstallationInfo, type IssueInput, type IssueRef, type RepoInfo, type SourceControl, type SubIssue } from "./source-control";

const API = "https://api.github.com";
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type GitHubAppOptions = { appId: string; privateKeyPem: string; fetch?: FetchLike; now?: () => number };

type RawInstallation = {
  id: number;
  account?: { login?: string; type?: string };
  repository_selection?: string;
  permissions?: Record<string, string>;
  events?: string[];
  suspended_at?: string | null;
};

function toInstallation(i: RawInstallation): InstallationInfo {
  return {
    id: i.id,
    accountLogin: i.account?.login ?? "",
    accountType: i.account?.type === "User" ? "User" : "Organization",
    repositorySelection: i.repository_selection === "all" ? "all" : "selected",
    permissions: i.permissions ?? {},
    events: i.events ?? [],
    suspended: Boolean(i.suspended_at),
  };
}

/**
 * GitHub App implementation of SourceControl. Installation tokens are created per installation, kept in memory only
 * until a minute before they expire, and are never logged, returned or sent to a browser.
 */
export class GitHubAppSourceControl implements SourceControl {
  readonly provider = "github" as const;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly tokens = new Map<number, { token: string; expiresAt: number }>();

  constructor(private readonly opts: GitHubAppOptions) {
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? (() => Date.now());
  }

  /** Short-lived App JWT (RS256). Exposed for tests. */
  appJwt(): string {
    const nowS = Math.floor(this.now() / 1000);
    const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const body = b64url(JSON.stringify({ iat: nowS - 60, exp: nowS + 540, iss: this.opts.appId }));
    const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(this.opts.privateKeyPem);
    return `${head}.${body}.${b64url(sig)}`;
  }

  private async request(path: string, token: string, init?: RequestInit): Promise<Response> {
    return this.fetchImpl(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "product-velocity",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
  }

  private async installationToken(installationId: number): Promise<string> {
    const cached = this.tokens.get(installationId);
    if (cached && cached.expiresAt - 60_000 > this.now()) return cached.token;
    const res = await this.request(`/app/installations/${installationId}/access_tokens`, this.appJwt(), { method: "POST" });
    if (!res.ok) throw new Error(`GitHub refused to create an installation token (${res.status})`);
    const j = (await res.json()) as { token?: string; expires_at?: string };
    if (!j.token) throw new Error("GitHub returned no installation token");
    this.tokens.set(installationId, { token: j.token, expiresAt: j.expires_at ? Date.parse(j.expires_at) : this.now() + 3_000_000 });
    return j.token;
  }

  async getInstallation(installationId: number): Promise<InstallationInfo | null> {
    const res = await this.request(`/app/installations/${installationId}`, this.appJwt());
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub installation lookup failed (${res.status})`);
    return toInstallation((await res.json()) as RawInstallation);
  }

  async listInstallations(): Promise<InstallationInfo[]> {
    const res = await this.request("/app/installations?per_page=100", this.appJwt());
    if (!res.ok) throw new Error(`GitHub installation list failed (${res.status})`);
    return ((await res.json()) as RawInstallation[]).map(toInstallation);
  }

  async listRepositories(installationId: number): Promise<RepoInfo[]> {
    const token = await this.installationToken(installationId);
    const out: RepoInfo[] = [];
    for (let page = 1; page <= 20; page++) {
      const res = await this.request(`/installation/repositories?per_page=100&page=${page}`, token);
      if (!res.ok) throw new Error(`GitHub repository list failed (${res.status})`);
      const j = (await res.json()) as { repositories?: { id: number; full_name: string; private: boolean }[] };
      const rows = j.repositories ?? [];
      out.push(...rows.map((r) => ({ id: r.id, fullName: r.full_name, private: r.private })));
      if (rows.length < 100) break;
    }
    return out;
  }

  async listIssueTypes(installationId: number, organisation: string): Promise<string[] | null> {
    const token = await this.installationToken(installationId);
    const res = await this.request(`/orgs/${encodeURIComponent(organisation)}/issue-types`, token);
    if (res.status === 403 || res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub issue type list failed (${res.status})`);
    return ((await res.json()) as { name: string }[]).map((t) => t.name);
  }

  private async call(installationId: number, method: string, path: string, body?: unknown): Promise<Response> {
    const token = await this.installationToken(installationId);
    const res = await this.request(path, token, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }) });
    if (res.status === 429 || (res.status === 403 && res.headers.get("retry-after"))) {
      throw new GitHubError(res.status, "GitHub is rate limiting this app; try again shortly", Number(res.headers.get("retry-after")) || 60);
    }
    return res;
  }

  private static ref(i: { number: number; id: number; node_id: string; html_url: string; title?: string; body?: string | null; state: string; state_reason?: string | null; updated_at?: string; closed_at?: string | null; labels?: (string | { name?: string })[] }): IssueRef {
    return {
      number: i.number, id: i.id, nodeId: i.node_id, htmlUrl: i.html_url, body: i.body ?? "", state: i.state === "closed" ? "closed" : "open",
      labels: (i.labels ?? []).map((l) => (typeof l === "string" ? l : l.name ?? "")).filter(Boolean),
      ...(typeof i.title === "string" ? { title: i.title } : {}), stateReason: i.state_reason ?? null, ...(i.updated_at ? { updatedAt: i.updated_at } : {}), closedAt: i.closed_at ?? null,
    };
  }

  async listIssues(installationId: number, repo: string): Promise<IssueSummary[]> {
    const out: IssueSummary[] = [];
    for (let page = 1; page <= 10; page++) {
      const res = await this.call(installationId, "GET", `/repos/${repo}/issues?state=all&sort=updated&direction=desc&per_page=100&page=${page}`);
      if (!res.ok) throw new GitHubError(res.status, `GitHub could not list issues (${res.status})`);
      const rows = (await res.json()) as { number: number; id: number; node_id: string; state: string; state_reason?: string | null; updated_at: string; closed_at?: string | null; pull_request?: unknown; title?: string; html_url?: string; type?: { name?: string } | null; labels?: ({ name?: string } | string)[]; parent_issue_url?: string | null }[];
      for (const r of rows) if (!r.pull_request) out.push({
        number: r.number, id: r.id, nodeId: r.node_id, state: r.state === "closed" ? "closed" : "open", stateReason: r.state_reason ?? null, updatedAt: r.updated_at, closedAt: r.closed_at ?? null,
        title: (r.title ?? "").slice(0, 300), issueType: r.type?.name ?? null, htmlUrl: r.html_url ?? null,
        labels: (r.labels ?? []).map((l) => (typeof l === "string" ? l : l.name ?? "")).filter(Boolean).slice(0, 30),
        parentNumber: r.parent_issue_url ? Number(r.parent_issue_url.split("/").pop()) || null : null,
      });
      if (rows.length < 100) break;
    }
    return out;
  }

  async listSubIssues(installationId: number, repo: string, number: number): Promise<SubIssue[] | null> {
    const out: SubIssue[] = [];
    for (let page = 1; page <= 2; page++) { // GitHub allows 100 sub-issues per parent
      const res = await this.call(installationId, "GET", `/repos/${repo}/issues/${number}/sub_issues?per_page=100&page=${page}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new GitHubError(res.status, `GitHub could not list sub-issues (${res.status})`);
      const rows = (await res.json()) as { number: number; id: number; node_id?: string; title: string; state: string; state_reason?: string | null; closed_at?: string | null; updated_at?: string; labels?: ({ name?: string } | string)[]; body?: string | null; repository_url?: string; assignees?: { login: string }[] }[];
      for (const r of rows) {
        const body = r.body ?? "";
        out.push({
          number: r.number, id: r.id, nodeId: r.node_id ?? "", repo: r.repository_url ? r.repository_url.replace(/^.*\/repos\//, "") : repo, title: r.title.slice(0, 200),
          state: r.state === "closed" ? "closed" : "open", stateReason: r.state_reason ?? null, closedAt: r.closed_at ?? null,
          assignees: (r.assignees ?? []).map((a) => a.login), ...(r.updated_at ? { updatedAt: r.updated_at } : {}), labels: (r.labels ?? []).map((l) => (typeof l === "string" ? l : l.name ?? "")).filter(Boolean), createdBy: body.includes("<!-- pv:source=claude -->") ? "claude" : body.includes("<!-- pv:begin") ? "app" : "engineer",
        });
      }
      if (rows.length < 100) break;
    }
    return out;
  }

  async createIssue(installationId: number, repo: string, input: IssueInput): Promise<IssueRef> {
    const res = await this.call(installationId, "POST", `/repos/${repo}/issues`, input);
    if (!res.ok) throw new GitHubError(res.status, `GitHub refused to create the issue (${res.status})`);
    return GitHubAppSourceControl.ref((await res.json()) as Parameters<typeof GitHubAppSourceControl.ref>[0]);
  }

  async updateIssue(installationId: number, repo: string, number: number, input: { title?: string; body?: string; type?: string; milestone?: number }): Promise<IssueRef> {
    const res = await this.call(installationId, "PATCH", `/repos/${repo}/issues/${number}`, input);
    if (!res.ok) throw new GitHubError(res.status, `GitHub refused to update the issue (${res.status})`);
    return GitHubAppSourceControl.ref((await res.json()) as Parameters<typeof GitHubAppSourceControl.ref>[0]);
  }

  async addLabels(installationId: number, repo: string, number: number, labels: string[]): Promise<void> {
    const res = await this.call(installationId, "POST", `/repos/${repo}/issues/${number}/labels`, { labels });
    if (!res.ok) throw new GitHubError(res.status, `GitHub refused to add labels (${res.status})`);
  }

  async removeLabel(installationId: number, repo: string, number: number, label: string): Promise<void> {
    const res = await this.call(installationId, "DELETE", `/repos/${repo}/issues/${number}/labels/${encodeURIComponent(label)}`);
    if (!res.ok && res.status !== 404) throw new GitHubError(res.status, `GitHub refused to remove a label (${res.status})`); // 404: it was not there
  }

  async getIssue(installationId: number, repo: string, number: number): Promise<IssueRef | null> {
    const res = await this.call(installationId, "GET", `/repos/${repo}/issues/${number}`);
    if (res.status === 404 || res.status === 410) return null;
    if (!res.ok) throw new GitHubError(res.status, `GitHub could not read the issue (${res.status})`);
    return GitHubAppSourceControl.ref((await res.json()) as Parameters<typeof GitHubAppSourceControl.ref>[0]);
  }

  async findIssueByMarker(installationId: number, repo: string, marker: string): Promise<IssueRef | null> {
    for (let page = 1; page <= 3; page++) {
      const res = await this.call(installationId, "GET", `/repos/${repo}/issues?state=all&sort=created&direction=desc&per_page=100&page=${page}`);
      if (!res.ok) throw new GitHubError(res.status, `GitHub could not list issues (${res.status})`);
      const rows = (await res.json()) as (Parameters<typeof GitHubAppSourceControl.ref>[0] & { pull_request?: unknown })[];
      const hit = rows.find((r) => !r.pull_request && (r.body ?? "").includes(marker));
      if (hit) return GitHubAppSourceControl.ref(hit);
      if (rows.length < 100) break;
    }
    return null;
  }

  async ensureLabels(installationId: number, repo: string, labels: { name: string; color: string; description: string }[]): Promise<void> {
    for (const l of labels) {
      const res = await this.call(installationId, "POST", `/repos/${repo}/labels`, l);
      if (!res.ok && res.status !== 422) throw new GitHubError(res.status, `GitHub refused to create the label ${l.name} (${res.status})`); // 422: it exists
    }
  }

  private async graphql<T>(installationId: number, query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.call(installationId, "POST", "/graphql", { query, variables });
    if (!res.ok) throw new GitHubError(res.status, `GitHub refused the Projects request (${res.status})`);
    const body = (await res.json()) as { data?: T; errors?: { type?: string; message?: string }[] };
    if (body.errors?.length) {
      const denied = body.errors.some((e) => e.type === "FORBIDDEN" || e.type === "INSUFFICIENT_SCOPES" || /not accessible by integration|forbidden/i.test(e.message ?? ""));
      const detail = body.errors.map((e) => `${e.type ?? "ERROR"}: ${e.message ?? ""}`).join("; ");
      console.error(JSON.stringify({ github: "graphql", errors: body.errors.map((e) => ({ type: e.type ?? null, message: String(e.message ?? "").slice(0, 300) })) })); // for the server log: GitHub's words about the person's own Project, no tokens
      throw new GitHubError(denied ? 403 : 422, denied ? "The App may not use Projects: grant the Organization Projects permission" : "GitHub could not do that on the Project", undefined, detail);
    }
    if (!body.data) throw new GitHubError(502, "GitHub returned no data for the Projects request");
    return body.data;
  }

  async listBoards(installationId: number, organisation: string): Promise<BoardInfo[]> {
    const d = await this.graphql<{ organization: { projectsV2: { nodes: { id: string; number: number; title: string; url: string; closed: boolean }[] } } | null }>(
      installationId,
      `query($org:String!){organization(login:$org){projectsV2(first:100){nodes{id number title url closed}}}}`,
      { org: organisation },
    );
    return (d.organization?.projectsV2.nodes ?? []).map((p) => ({ id: p.id, number: p.number, title: p.title, url: p.url, closed: p.closed }));
  }

  async getBoardFields(installationId: number, boardId: string): Promise<BoardField[] | null> {
    const d = await this.graphql<{ node: { fields: { nodes: { id?: string; name?: string; dataType?: string; options?: { id: string; name: string }[] }[] } } | null }>(
      installationId,
      `query($p:ID!){node(id:$p){... on ProjectV2{fields(first:100){nodes{... on ProjectV2Field{id name dataType} ... on ProjectV2SingleSelectField{id name dataType options{id name}} ... on ProjectV2IterationField{id name dataType}}}}}}`,
      { p: boardId },
    );
    if (!d.node?.fields) return null;
    const known = new Set(["TEXT", "NUMBER", "DATE", "SINGLE_SELECT", "ITERATION"]);
    return d.node.fields.nodes.filter((f) => f.id && f.name).map((f) => ({ id: f.id!, name: f.name!, dataType: (known.has(f.dataType ?? "") ? f.dataType : "OTHER") as BoardField["dataType"], ...(f.options ? { options: f.options } : {}) }));
  }

  async listBoardItems(installationId: number, boardId: string, statusField: string, extra: { iterationField?: string | null; dateField?: string | null } = {}): Promise<BoardItemStatus[]> {
    type Node = { id: string; content: { id?: string; number?: number; repository?: { nameWithOwner?: string } } | null; fieldValueByName: { name?: string } | null; it: { title?: string } | null; dt: { date?: string } | null };
    const out: BoardItemStatus[] = [];
    let after: string | null = null;
    for (let page = 0; page < 10; page++) { // 1,000 items
      const d: { node: { items: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Node[] } } | null } = await this.graphql(
        installationId,
        `query($p:ID!,$n:String!,$i:String!,$d:String!,$after:String){node(id:$p){... on ProjectV2{items(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{id content{... on Issue{id number repository{nameWithOwner}}} fieldValueByName(name:$n){... on ProjectV2ItemFieldSingleSelectValue{name}} it:fieldValueByName(name:$i){... on ProjectV2ItemFieldIterationValue{title}} dt:fieldValueByName(name:$d){... on ProjectV2ItemFieldDateValue{date}}}}}}}`,
        { p: boardId, n: statusField, i: extra.iterationField ?? "", d: extra.dateField ?? "", after },
      );
      if (!d.node) break;
      for (const n of d.node.items.nodes) {
        const c = n.content;
        if (!c?.id || typeof c.number !== "number" || !c.repository?.nameWithOwner) continue; // drafts, pull requests and notes are not initiatives
        out.push({ itemId: n.id, issueNodeId: c.id, repo: c.repository.nameWithOwner, number: c.number, status: n.fieldValueByName?.name ?? null, ...(extra.iterationField ? { iteration: n.it?.title ?? null } : {}), ...(extra.dateField ? { targetDate: n.dt?.date?.slice(0, 10) ?? null } : {}) });
      }
      if (!d.node.items.pageInfo.hasNextPage) break;
      after = d.node.items.pageInfo.endCursor;
    }
    return out;
  }

  async listLinkedPullRequests(installationId: number, issues: { repo: string; number: number }[]): Promise<PrRef[]> {
    const byRepo = new Map<string, number[]>();
    for (const i of issues) if (Number.isInteger(i.number) && i.number > 0 && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(i.repo)) byRepo.set(i.repo, [...(byRepo.get(i.repo) ?? []), i.number]);
    const out: PrRef[] = [];
    for (const [repo, numbers] of byRepo) {
      const [owner, name] = repo.split("/") as [string, string];
      for (let at = 0; at < numbers.length; at += 40) { // one request per 40 issues of a repository
        const part = numbers.slice(at, at + 40);
        const body = part.map((n, k) => `i${k}:issue(number:${n}){closedByPullRequestsReferences(first:20,includeClosedPrs:true){nodes{number state repository{nameWithOwner}}}}`).join(" ");
        const d = await this.graphql<{ repository: Record<string, { closedByPullRequestsReferences: { nodes: { number: number; state: string; repository?: { nameWithOwner?: string } }[] } } | null> | null }>(installationId, `query($o:String!,$n:String!){repository(owner:$o,name:$n){${body}}}`, { o: owner, n: name });
        for (const v of Object.values(d.repository ?? {})) {
          for (const p of v?.closedByPullRequestsReferences.nodes ?? []) out.push({ repo: p.repository?.nameWithOwner ?? repo, number: p.number, state: p.state === "MERGED" ? "merged" : p.state === "OPEN" ? "open" : "closed" });
        }
      }
    }
    return out;
  }

  async getDefaultBranchRollup(installationId: number, repo: string): Promise<string | null> {
    const [owner, name] = repo.split("/") as [string, string];
    const d = await this.graphql<{ repository: { defaultBranchRef: { target: { statusCheckRollup?: { state?: string } | null } | null } | null } | null }>(
      installationId,
      `query($o:String!,$n:String!){repository(owner:$o,name:$n){defaultBranchRef{target{... on Commit{statusCheckRollup{state}}}}}}`,
      { o: owner, n: name },
    );
    return d.repository?.defaultBranchRef?.target?.statusCheckRollup?.state ?? null;
  }

  async listReleases(installationId: number, repo: string): Promise<ReleaseRef[]> {
    const res = await this.call(installationId, "GET", `/repos/${repo}/releases?per_page=20`);
    if (res.status === 404) return [];
    if (!res.ok) throw new GitHubError(res.status, `GitHub could not list releases (${res.status})`);
    const rows = (await res.json()) as { tag_name?: string; name?: string | null; draft?: boolean; published_at?: string | null }[];
    return rows.filter((r) => !r.draft && typeof r.published_at === "string" && r.tag_name).map((r) => ({ repo, tag: r.tag_name!.slice(0, 100), name: r.name ? r.name.slice(0, 100) : null, publishedAt: r.published_at! }));
  }

  async getClosingIssues(installationId: number, repo: string, pullNumber: number): Promise<{ repo: string; number: number }[]> {
    const [owner, name] = repo.split("/") as [string, string];
    const d = await this.graphql<{ repository: { pullRequest: { closingIssuesReferences: { nodes: { number: number; repository?: { nameWithOwner?: string } }[] } } | null } | null }>(
      installationId,
      `query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){closingIssuesReferences(first:20){nodes{number repository{nameWithOwner}}}}}}`,
      { o: owner, n: name, p: pullNumber },
    );
    return (d.repository?.pullRequest?.closingIssuesReferences.nodes ?? []).map((i) => ({ repo: i.repository?.nameWithOwner ?? repo, number: i.number }));
  }

  async getBoardItemValues(installationId: number, itemId: string): Promise<Record<string, BoardItemValue> | null> {
    type V = { name?: string; date?: string; text?: string; field?: { id?: string } };
    const d: { node: { fieldValues: { nodes: (V | null)[] } } | null } = await this.graphql(
      installationId,
      `query($i:ID!){node(id:$i){... on ProjectV2Item{fieldValues(first:50){nodes{... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2FieldCommon{id}}} ... on ProjectV2ItemFieldDateValue{date field{... on ProjectV2FieldCommon{id}}} ... on ProjectV2ItemFieldTextValue{text field{... on ProjectV2FieldCommon{id}}}}}}}}`,
      { i: itemId },
    );
    if (!d.node?.fieldValues) return null;
    const out: Record<string, BoardItemValue> = {};
    for (const n of d.node.fieldValues.nodes) {
      const id = n?.field?.id;
      if (!n || !id) continue;
      if (typeof n.name === "string") out[id] = { option: n.name };
      else if (typeof n.date === "string") out[id] = { date: n.date.slice(0, 10) };
      else if (typeof n.text === "string") out[id] = { text: n.text };
    }
    return out;
  }

  async addBoardItem(installationId: number, boardId: string, issueNodeId: string): Promise<string> {
    const d = await this.graphql<{ addProjectV2ItemById: { item: { id: string } } }>(
      installationId,
      `mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}`,
      { p: boardId, c: issueNodeId },
    );
    return d.addProjectV2ItemById.item.id;
  }

  async setBoardValue(installationId: number, boardId: string, itemId: string, fieldId: string, value: BoardValue): Promise<void> {
    const v = "optionId" in value ? { singleSelectOptionId: value.optionId } : value;
    await this.graphql(
      installationId,
      `mutation($p:ID!,$i:ID!,$f:ID!,$v:ProjectV2FieldValue!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:$v}){projectV2Item{id}}}`,
      { p: boardId, i: itemId, f: fieldId, v },
    );
  }

  async ensureMilestone(installationId: number, repo: string, m: { title: string; dueOn: string }): Promise<number> {
    for (let page = 1; page <= 5; page++) {
      const res = await this.call(installationId, "GET", `/repos/${repo}/milestones?state=all&per_page=100&page=${page}`);
      if (!res.ok) throw new GitHubError(res.status, `GitHub refused to list milestones (${res.status})`);
      const list = (await res.json()) as { number: number; title: string }[];
      const found = list.find((x) => x.title === m.title);
      if (found) return found.number;
      if (list.length < 100) break;
    }
    const res = await this.call(installationId, "POST", `/repos/${repo}/milestones`, { title: m.title, due_on: m.dueOn, description: "Managed by Product Velocity" });
    if (res.status === 422) throw new GitHubError(422, "GitHub refused to create the milestone (422)");
    if (!res.ok) throw new GitHubError(res.status, `GitHub refused to create the milestone (${res.status})`);
    return ((await res.json()) as { number: number }).number;
  }

  async listRecentDeliveries(): Promise<DeliverySummary[]> {
    const res = await this.request("/app/hook/deliveries?per_page=50", this.appJwt());
    if (!res.ok) throw new Error(`GitHub delivery list failed (${res.status})`);
    return ((await res.json()) as { event: string; action: string | null; status_code: number; delivered_at: string }[]).map((d) => ({
      event: d.event,
      action: d.action,
      statusCode: d.status_code,
      deliveredAt: d.delivered_at,
    }));
  }
}

/** Builds the client from the environment, or null when the App is not configured on this server. */
export function sourceControlFromEnv(env: Record<string, string | undefined>): GitHubAppSourceControl | null {
  const appId = env.GITHUB_APP_ID;
  const b64 = env.GITHUB_APP_PRIVATE_KEY_B64;
  if (!appId || !b64) return null;
  return new GitHubAppSourceControl({ appId, privateKeyPem: Buffer.from(b64, "base64").toString("utf8") });
}
