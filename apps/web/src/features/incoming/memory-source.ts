import type { BatchOutcome, IncomingIssue, IncomingRule, IncomingSource } from "./types";

/** In-memory stand-in for the test page: fictional issues, the same rules as the database functions (no writes anywhere). */
export class MemoryIncomingSource implements IncomingSource {
  issues: IncomingIssue[];
  rules: IncomingRule[] = [{ id: "r1", kind: "label", value: "support" }];
  private nextItem = 1;
  constructor(seed?: IncomingIssue[]) {
    this.issues = seed ?? sampleIncoming();
  }
  async load() { return { connectionId: "c1", issues: this.issues.map((i) => ({ ...i })), rules: this.rules.map((r) => ({ ...r })) }; }
  async setState(ids: string[], state: "not_pulled" | "ignored", reason: string | null): Promise<BatchOutcome[]> {
    return ids.map((id) => {
      const i = this.issues.find((x) => x.id === id);
      if (!i) return { id, ok: false, reason: "You cannot change this issue." };
      if (i.pullState === "pulled" && i.itemId) return { id, ok: false, reason: "This issue is already an initiative. Remove the initiative first." };
      i.pullState = state; i.itemId = null; i.ignoreReason = state === "ignored" ? reason : null;
      return { id, ok: true, reason: null };
    });
  }
  async pullIn(ids: string[]): Promise<BatchOutcome[]> {
    return ids.map((id) => {
      const i = this.issues.find((x) => x.id === id);
      if (!i) return { id, ok: false, reason: "Issue not found." };
      if (i.pullState === "pulled") return { id, ok: false, reason: "Already an initiative." };
      const code = `R-${100 + this.nextItem++}`;
      i.pullState = "pulled"; i.itemId = `item-${code}`; i.ignoreReason = null;
      return { id, ok: true, reason: null, itemId: i.itemId, itemCode: code };
    });
  }
  async discardItems(itemIds: string[]) {
    for (const i of this.issues) if (i.itemId && itemIds.includes(i.itemId)) i.itemId = null;
    return { ok: true };
  }
  async addRule(_c: string, kind: IncomingRule["kind"], value: string) {
    if (this.rules.some((r) => r.kind === kind && r.value.toLowerCase() === value.toLowerCase())) return { ok: false as const, error: "That rule already exists." };
    this.rules.push({ id: `r${this.rules.length + 1}`, kind, value });
    return { ok: true as const };
  }
  async removeRule(ruleId: string) { this.rules = this.rules.filter((r) => r.id !== ruleId); return { ok: true as const }; }
}

export function sampleIncoming(): IncomingIssue[] {
  const mk = (n: number, title: string, o: Partial<IncomingIssue> = {}): IncomingIssue => ({
    id: `t${n}`, repo: "Acme/App", number: n, title, issueType: null, labels: [], state: "open", parentNumber: null, url: `https://github.com/Acme/App/issues/${n}`,
    pullState: "not_pulled", ignoreReason: null, itemId: null, updatedAt: new Date(Date.UTC(2026, 9, 20) - n * 3 * 86_400_000).toISOString(), ...o,
  });
  return [
    mk(101, "Checkout fails with a saved card", { issueType: "Bug", labels: ["payments"] }),
    mk(102, "Export the roadmap to Excel", { issueType: "Feature", labels: ["export"] }),
    mk(103, "Rename the settings menu", { issueType: "Task" }),
    mk(104, "Customer asks about invoices", { labels: ["support"], pullState: "ignored", ignoreReason: "Rule: label support" }),
    mk(105, "Dark theme for the website", { issueType: "Feature", state: "closed" }),
    mk(106, "Import wizard", { issueType: "Feature", labels: ["import"] }),
    mk(107, "Import wizard: map columns", { issueType: "Task", parentNumber: 106 }),
    mk(108, "Import wizard: preview step", { issueType: "Task", parentNumber: 106 }),
    mk(109, "Planning cycles", { issueType: "Feature", pullState: "pulled", itemId: "item-R-09" }),
    mk(110, "Old spike notes", { issueType: "Task", repo: "Acme/Notes", url: "https://github.com/Acme/Notes/issues/110" }),
  ];
}
