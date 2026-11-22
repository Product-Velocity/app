import type { GroupRow } from "@pv/domain";
import { agentsText, chipMatches, isPaused, statusLabel, trackerText, type AccountRow, type ChipId } from "./accounts-model";

// Filter, group by and search of the All accounts grid: the same bar and the same group rows as the Roadmap and Changes grids, with the
// filters and groupings of an account list. Pure data, so it is unit-tested. Never a grouping by person (rule 8): accounts only.

export type QuickId = Exclude<ChipId, "all">;
export const QUICK: { id: QuickId; label: string; hint: string }[] = [
  { id: "active", label: "Active", hint: "Not paused." },
  { id: "paused", label: "Paused", hint: "Members cannot open the account." },
  { id: "agents", label: "AI agents connected", hint: "At least one live Claude or other AI connection." },
  { id: "requests", label: "Access requests waiting", hint: "People waiting for an admin to approve them." },
  { id: "quiet", label: "No activity in 30 days", hint: "Includes accounts that never had any." },
];

export type RuleField = "status" | "plan" | "country" | "github" | "jira" | "agent" | "access";
export const RULE_FIELDS: { id: RuleField; label: string }[] = [
  { id: "status", label: "Status" }, { id: "plan", label: "Plan" }, { id: "country", label: "Country" },
  { id: "github", label: "GitHub" }, { id: "jira", label: "Jira" }, { id: "agent", label: "AI agent" }, { id: "access", label: "Platform access" },
];
export type Rule = { field: RuleField; values: string[] };
export type AccountFilters = { search: string; quick: QuickId[]; rules: Rule[] };
export const NO_FILTERS: AccountFilters = { search: "", quick: [], rules: [] };

/** The values an account has for a rule field (an account can have several AI agents). */
export function fieldValues(r: AccountRow, f: RuleField): string[] {
  switch (f) {
    case "status": return [statusLabel(r)];
    case "plan": return [r.plan];
    case "country": return [r.country ?? "Not set"];
    case "github": return [trackerText(r.github_state)];
    case "jira": return [trackerText(r.jira_state)];
    case "agent": return r.ai_agents.length ? r.ai_agents.map((a) => a.name) : ["None"];
    case "access": return [r.access_override ? "Read-only" : "Default"];
  }
}

export const fieldChoices = (rows: readonly AccountRow[], f: RuleField): { value: string; label: string }[] =>
  [...new Set(rows.flatMap((r) => fieldValues(r, f)))].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));

export const filterCount = (f: AccountFilters) => f.quick.length + f.rules.filter((r) => r.values.length > 0).length;

const searchText = (r: AccountRow) =>
  [r.name, r.company_url, r.owner_name, r.owner_email, r.plan, r.country, agentsText(r), statusLabel(r)].filter(Boolean).join(" ").toLowerCase();

export function filterAccounts(rows: readonly AccountRow[], f: AccountFilters, now = Date.now()): AccountRow[] {
  const q = f.search.trim().toLowerCase();
  const rules = f.rules.filter((r) => r.values.length > 0);
  return rows.filter((r) =>
    (!q || searchText(r).includes(q))
    && f.quick.every((c) => chipMatches(r, c, now))
    && rules.every((rule) => fieldValues(r, rule.field).some((v) => rule.values.includes(v))));
}

export type GroupBy = "status" | "plan" | "country" | "github" | "jira" | "agents";
export const GROUP_BYS: { id: GroupBy; label: string }[] = [
  { id: "status", label: "Status" }, { id: "plan", label: "Plan" }, { id: "country", label: "Country" },
  { id: "github", label: "GitHub" }, { id: "jira", label: "Jira" }, { id: "agents", label: "AI agents" },
];
const groupValue = (r: AccountRow, g: GroupBy): string =>
  g === "agents" ? (r.ai_agents.length ? "AI agents connected" : "No AI agent connected") : fieldValues(r, g)[0]!;
export const groupSummary = (by: GroupBy | null, then: GroupBy | null) =>
  !by ? "None" : [by, then].filter((x): x is GroupBy => !!x).map((g) => GROUP_BYS.find((x) => x.id === g)!.label).join(" › ");

export type AccountGridRow = AccountRow | GroupRow;
export const isHeader = (r: unknown): r is GroupRow => !!r && typeof r === "object" && (r as { __group?: boolean }).__group === true;

/** Header rows (we draw them; row grouping is Enterprise-only in AG Grid) followed by their accounts, hidden when collapsed. */
export function groupAccountRows(rows: readonly AccountRow[], by: GroupBy | null, then: GroupBy | null, collapsed: ReadonlySet<string>): AccountGridRow[] {
  if (!by) return [...rows];
  const out: AccountGridRow[] = [];
  const bucket = (list: readonly AccountRow[], g: GroupBy) => {
    const m = new Map<string, AccountRow[]>();
    for (const r of list) { const k = groupValue(r, g); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };
  const header = (key: string, label: string, list: readonly AccountRow[], level: 0 | 1): GroupRow => ({
    __group: true, id: `g:${key}`, key, label, count: list.length, collapsed: collapsed.has(key), level, healthSummary: "",
    unit: list.length === 1 ? "account" : "accounts",
    badges: list.some(isPaused) && level === 0 && by !== "status" ? [{ text: `${list.filter(isPaused).length} paused`, tone: "risk" }] : undefined,
  } as GroupRow);
  for (const [v1, l1] of bucket(rows, by)) {
    const k1 = `${by}:${v1}`;
    out.push(header(k1, v1, l1, 0));
    if (collapsed.has(k1)) continue;
    if (!then) { out.push(...l1); continue; }
    for (const [v2, l2] of bucket(l1, then)) {
      const k2 = `${k1}|${then}:${v2}`;
      out.push(header(k2, v2, l2, 1));
      if (!collapsed.has(k2)) out.push(...l2);
    }
  }
  return out;
}
