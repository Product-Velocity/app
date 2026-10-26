import type { DeliverySummary, InstallationInfo, IssueInput, IssueRef, IssueSummary, RepoInfo, SourceControl, SubIssue } from "./source-control";

/** In-memory SourceControl for tests: records every call so a test can prove what was (not) sent. */
export class MemorySourceControl implements SourceControl {
  readonly provider = "github" as const;
  issues = new Map<string, IssueRef & { title: string; labels: string[] }>();
  labels = new Set<string>();
  /** Labels removed from issues, in order. */
  removed: string[] = [];
  calls: string[] = [];
  /** Payloads exactly as they would be serialised to GitHub. */
  sent: unknown[] = [];
  failNext: Error | null = null;
  private n = 100;

  private tick(name: string, payload?: unknown) {
    this.calls.push(name);
    if (payload !== undefined) this.sent.push(payload);
    if (this.failNext) { const e = this.failNext; this.failNext = null; throw e; }
  }
  async getInstallation(id: number): Promise<InstallationInfo | null> { return { id, accountLogin: "Acme", accountType: "Organization", repositorySelection: "selected", permissions: {}, events: [], suspended: false }; }
  async listInstallations() { return []; }
  async listRepositories(): Promise<RepoInfo[]> { return []; }
  /** Issue types of the organisation, or null when the App may not read them. */
  types: string[] | null = null;
  async listIssueTypes() { return this.types; }
  milestones: { number: number; repo: string; title: string; dueOn: string }[] = [];
  async ensureMilestone(_i: number, repo: string, m: { title: string; dueOn: string }) {
    this.tick("ensureMilestone");
    const found = this.milestones.find((x) => x.repo === repo && x.title === m.title);
    if (found) return found.number;
    const number = this.milestones.length + 1;
    this.milestones.push({ number, repo, title: m.title, dueOn: m.dueOn });
    return number;
  }
  async listRecentDeliveries(): Promise<DeliverySummary[]> { return []; }
  /** Issues GitHub would report for a repository, set by a test. */
  subs = new Map<string, SubIssue[] | null>();
  async listSubIssues(_i: number, repo: string, number: number): Promise<SubIssue[] | null> { this.tick("listSubIssues"); const k = `${repo}#${number}`; return this.subs.has(k) ? this.subs.get(k)! : []; }
  listed = new Map<string, IssueSummary[]>();
  async listIssues(_i: number, repo: string): Promise<IssueSummary[]> { this.tick("listIssues"); return this.listed.get(repo) ?? []; }
  async createIssue(_i: number, repo: string, input: IssueInput): Promise<IssueRef> {
    this.tick("createIssue", input);
    const number = ++this.n;
    const issue = { number, id: number * 10, nodeId: `n${number}`, htmlUrl: `https://github.com/${repo}/issues/${number}`, body: input.body, state: "open" as const, title: input.title, labels: [...input.labels] };
    this.issues.set(`${repo}#${number}`, issue);
    return issue;
  }
  async updateIssue(_i: number, repo: string, number: number, input: { title?: string; body?: string; type?: string; milestone?: number }): Promise<IssueRef> {
    this.tick("updateIssue", input);
    const issue = this.issues.get(`${repo}#${number}`)!;
    Object.assign(issue, input);
    return issue;
  }
  async addLabels(_i: number, repo: string, number: number, labels: string[]) {
    this.tick("addLabels", labels);
    const issue = this.issues.get(`${repo}#${number}`)!;
    for (const l of labels) if (!issue.labels.includes(l)) issue.labels.push(l);
  }
  async removeLabel(_i: number, repo: string, number: number, label: string) {
    this.tick("removeLabel", label);
    const issue = this.issues.get(`${repo}#${number}`)!;
    issue.labels = issue.labels.filter((l) => l !== label);
    this.removed.push(label);
  }
  async getIssue(_i: number, repo: string, number: number) { this.tick("getIssue"); return this.issues.get(`${repo}#${number}`) ?? null; }
  async findIssueByMarker(_i: number, repo: string, marker: string) {
    this.tick("findIssueByMarker");
    return [...this.issues.entries()].find(([k, v]) => k.startsWith(`${repo}#`) && v.body.includes(marker))?.[1] ?? null;
  }
  async ensureLabels(_i: number, _repo: string, labels: { name: string }[]) { this.tick("ensureLabels", labels); for (const l of labels) this.labels.add(l.name); }
}
