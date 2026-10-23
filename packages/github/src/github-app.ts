import { createSign } from "node:crypto";
import { GitHubError, type IssueSummary, type DeliverySummary, type InstallationInfo, type IssueInput, type IssueRef, type RepoInfo, type SourceControl, type SubIssue } from "./source-control";

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

  private static ref(i: { number: number; id: number; node_id: string; html_url: string; body?: string | null; state: string }): IssueRef {
    return { number: i.number, id: i.id, nodeId: i.node_id, htmlUrl: i.html_url, body: i.body ?? "", state: i.state === "closed" ? "closed" : "open" };
  }

  async listIssues(installationId: number, repo: string): Promise<IssueSummary[]> {
    const out: IssueSummary[] = [];
    for (let page = 1; page <= 10; page++) {
      const res = await this.call(installationId, "GET", `/repos/${repo}/issues?state=all&sort=updated&direction=desc&per_page=100&page=${page}`);
      if (!res.ok) throw new GitHubError(res.status, `GitHub could not list issues (${res.status})`);
      const rows = (await res.json()) as { number: number; id: number; node_id: string; state: string; state_reason?: string | null; updated_at: string; closed_at?: string | null; pull_request?: unknown }[];
      for (const r of rows) if (!r.pull_request) out.push({ number: r.number, id: r.id, nodeId: r.node_id, state: r.state === "closed" ? "closed" : "open", stateReason: r.state_reason ?? null, updatedAt: r.updated_at, closedAt: r.closed_at ?? null });
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
      const rows = (await res.json()) as { number: number; id: number; title: string; state: string; state_reason?: string | null; closed_at?: string | null; body?: string | null; repository_url?: string; assignees?: { login: string }[] }[];
      for (const r of rows) {
        const body = r.body ?? "";
        out.push({
          number: r.number, id: r.id, repo: r.repository_url ? r.repository_url.replace(/^.*\/repos\//, "") : repo, title: r.title.slice(0, 200),
          state: r.state === "closed" ? "closed" : "open", stateReason: r.state_reason ?? null, closedAt: r.closed_at ?? null,
          assignees: (r.assignees ?? []).map((a) => a.login), createdBy: body.includes("<!-- pv:source=claude -->") ? "claude" : body.includes("<!-- pv:begin") ? "app" : "engineer",
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

  async updateIssue(installationId: number, repo: string, number: number, input: { title?: string; body?: string }): Promise<IssueRef> {
    const res = await this.call(installationId, "PATCH", `/repos/${repo}/issues/${number}`, input);
    if (!res.ok) throw new GitHubError(res.status, `GitHub refused to update the issue (${res.status})`);
    return GitHubAppSourceControl.ref((await res.json()) as Parameters<typeof GitHubAppSourceControl.ref>[0]);
  }

  async addLabels(installationId: number, repo: string, number: number, labels: string[]): Promise<void> {
    const res = await this.call(installationId, "POST", `/repos/${repo}/issues/${number}/labels`, { labels });
    if (!res.ok) throw new GitHubError(res.status, `GitHub refused to add labels (${res.status})`);
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
