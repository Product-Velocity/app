// Fallback for the Jira tab (issue #67): when the full read of an initiative's children has not written a tree (it failed or has not run), the
// children Product Velocity already holds as light issue records (`jira_issues.parent_key`, read with the project's open work) are shown instead.
// Pure and read only. Same two levels as the real tree (child, sub-task). Assignees are not known here. Text from Jira is data.
export type LightIssue = {
  issue_key: string; parent_key: string | null; title: string; issue_type: string | null; status: string | null;
  status_category: string | null; html_url: string | null; jira_updated_at: string | null;
};
export type LightTreeRow = {
  key: string; parentKey: string; level: 1 | 2; position: number; title: string; type: string | null; status: string | null;
  category: "new" | "indeterminate" | "done" | null; assignee: null; url: string | null; updatedAt: string | null; fromList: true;
};

const numberOf = (key: string) => Number(key.slice(key.lastIndexOf("-") + 1));
const category = (v: string | null): LightTreeRow["category"] => (v === "new" || v === "indeterminate" || v === "done" ? v : null);

export function lightTree(rootKey: string, issues: LightIssue[]): LightTreeRow[] {
  const byParent = new Map<string, LightIssue[]>();
  for (const i of issues) {
    if (!i.parent_key || i.issue_key === rootKey) continue;
    byParent.set(i.parent_key, [...(byParent.get(i.parent_key) ?? []), i]);
  }
  const out: LightTreeRow[] = [];
  const seen = new Set<string>([rootKey]);
  const push = (i: LightIssue, level: 1 | 2, parentKey: string) => {
    if (seen.has(i.issue_key)) return;
    seen.add(i.issue_key);
    out.push({ key: i.issue_key, parentKey, level, position: out.length, title: i.title, type: i.issue_type, status: i.status, category: category(i.status_category), assignee: null, url: i.html_url, updatedAt: i.jira_updated_at, fromList: true });
  };
  const sorted = (list: LightIssue[] | undefined) => [...(list ?? [])].sort((a, b) => numberOf(a.issue_key) - numberOf(b.issue_key));
  for (const c of sorted(byParent.get(rootKey))) {
    push(c, 1, rootKey);
    for (const s of sorted(byParent.get(c.issue_key))) push(s, 2, c.issue_key);
  }
  return out;
}
