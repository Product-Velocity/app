// Jira connection checks (issue #452, parent #431): the Initiative-level checks of the Test connection page, each with a verdict
// (pass / warn / fail), a reason and what to do. Pure over an injected `call`, so they are tested with a fake Jira and run on the stored
// connection in production. The read checks write nothing. The write check creates 2 test issues and ALWAYS deletes them again
// (probeInitiativeWrite does the work and the cleanup). Nothing here keeps issue text, people, e-mails or site addresses: only keys, counts,
// type names, project keys and Jira's own error reason, which `cleanReason` strips of addresses.
import { whyJira } from "@/lib/atlassian/jira-write";
import { probeInitiativeWrite, type ProbeCall, type ProbeStep } from "@/lib/spikes/atlassian-probes";
import type { Sleep } from "@/lib/atlassian/jira-write";

export type CheckStatus = "pass" | "warn" | "fail";
export type CheckResult = { key: string; label: string; status: CheckStatus; reason: string; fix?: string };
export type CheckKind = "read" | "write";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const ISSUE_KEY = /^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$/;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Jira's own reasons can carry an address or an e-mail: strip both and cap the length (the result is saved and shown). */
export function cleanReason(s: string): string {
  return s
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/\S+\.atlassian\.net\S*/gi, "[link]")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}
const res = (key: string, label: string, status: CheckStatus, reason: string, fix?: string): CheckResult => ({ key, label, status, reason: cleanReason(reason), ...(fix ? { fix: cleanReason(fix) } : {}) });

/**
 * The read-only checks. `linkedProjects` are the Jira project keys linked to Product Velocity (their issues get live updates by webhook).
 * `initiativeKey` picks the Initiative to read; without it the first Initiative-level issue found is used.
 */
export async function runReadChecks(call: ProbeCall, ctx: { linkedProjects: string[]; initiativeKey?: string }): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const t = await call("GET", "/issuetype");
  if (t.status !== 200) return [res("level", "A hierarchy level above Epic", "fail", `Jira did not return the issue types (HTTP ${t.status}): ${whyJira(t.json) || "no detail"}.`, "Sign in to Jira again on the Jira page, then run the checks again.")];
  const types = arr(t.json).filter((x) => Number.isFinite(Number(x.hierarchyLevel)));
  const above = types.filter((x) => Number(x.hierarchyLevel) >= 2);
  if (above.length === 0) {
    return [res("level", "A hierarchy level above Epic", "fail", "This Jira site has no issue type above Epic, so there is no Initiative level to read.", "In Jira, add a level above Epic in the issue type hierarchy (a Jira admin setting; it needs a company-managed project and a plan that includes it). Until then link epics directly.")];
  }
  out.push(res("level", "A hierarchy level above Epic", "pass", `Found: ${[...new Set(above.map((x) => `${String(x.name)} (level ${Number(x.hierarchyLevel)})`))].join(", ")}.`));

  const levelsByName = new Map<string, Set<number>>();
  for (const x of types) levelsByName.set(String(x.name), (levelsByName.get(String(x.name)) ?? new Set()).add(Number(x.hierarchyLevel)));
  const twins = [...levelsByName].filter(([, l]) => l.size > 1);
  out.push(twins.length === 0
    ? res("same_name", "Issue type names are unique", "pass", "No two issue types share a name at different levels.")
    : res("same_name", "Issue type names are unique", "warn", `${twins.map(([n, l]) => `"${n}" exists at ${[...l].sort((a, b) => b - a).map((v) => `level ${v}`).join(" and ")}`).join("; ")}.`, "Choose the type by its level (shown next to the name in Product Velocity), never by name alone."));

  let key = ISSUE_KEY.test(ctx.initiativeKey ?? "") ? ctx.initiativeKey! : "";
  if (!key) {
    const ids = [...new Set(above.map((x) => String(x.id)).filter((id) => /^\d+$/.test(id)))];
    const s = await call("GET", `/search/jql?${new URLSearchParams({ jql: `issuetype in (${ids.join(",")}) ORDER BY key ASC`, maxResults: "1", fields: "summary" })}`);
    if (s.status !== 200) return [...out, res("initiative", "An Initiative to read", "fail", `Jira refused the search (HTTP ${s.status}): ${whyJira(s.json) || "no detail"}.`, "Check that the signed-in user can browse the Initiative project.")];
    key = String(arr(obj(s.json).issues)[0]?.key ?? "");
    if (!key) return [...out, res("initiative", "An Initiative to read", "warn", "No Initiative-level issue was found (or this sign-in cannot browse the project that holds them).", "Create an Initiative in Jira with at least one epic under it, or enter its key above, then run the checks again.")];
  }
  const i = await call("GET", `/issue/${key}?fields=issuetype,project`);
  if (i.status !== 200) return [...out, res("initiative", "An Initiative to read", "fail", `Jira did not return ${key} (HTTP ${i.status}).`, "Check the key and that the signed-in user can browse its project.")];
  const f = obj(obj(i.json).fields);
  out.push(res("initiative", "An Initiative to read", "pass", `${key}: type ${String(obj(f.issuetype).name ?? "?")}, level ${String(obj(f.issuetype).hierarchyLevel ?? "?")}, project ${String(obj(f.project).key ?? "?")}.`));

  const c = await call("GET", `/search/jql?${new URLSearchParams({ jql: `parent in ("${key}") ORDER BY key ASC`, maxResults: "100", fields: "issuetype,project,status" })}`);
  if (c.status !== 200) return [...out, res("children", "Its children are read", "fail", `Jira refused the children search (HTTP ${c.status}): ${whyJira(c.json) || "no detail"}.`, "Check that the signed-in user can browse every project that holds epics under the Initiative.")];
  const kids = arr(obj(c.json).issues);
  const projects = [...new Set(kids.map((k) => String(obj(obj(obj(k).fields).project).key ?? "?")))];
  if (kids.length === 0) {
    out.push(res("children", "Its children are read", "warn", `${key} has no children visible to this sign-in.`, "Put at least one epic under it in Jira. If it already has some, the sign-in cannot browse their project."));
    return out;
  }
  out.push(res("children", "Its children are read", "pass", `${plural(kids.length, "child", "children")} from ${plural(projects.length, "project", "projects")} (${projects.join(", ")}), read with the same parent query Product Velocity uses.`));
  const linked = new Set(ctx.linkedProjects);
  const unlinked = projects.filter((p) => !linked.has(p));
  out.push(unlinked.length === 0
    ? res("live_updates", "Live updates cover the epics", "pass", "Every project of those children is linked, so status changes arrive by webhook.")
    : res("live_updates", "Live updates cover the epics", "warn", `Epics in ${unlinked.join(", ")} are not in a linked project, so their status changes only arrive on Sync with Jira and in the daily check.`, "Accept that, or link those projects so they get live updates."));
  out.push(res("visibility", "Nothing is hidden from this sign-in", "warn", `Read ${plural(kids.length, "child", "children")} of ${key}. Product Velocity cannot count what Jira hides from this sign-in. Compare this number with the child count on ${key} in Jira.`, "If Jira shows more, give the Product Velocity sign-in access to the missing projects."));
  return out;
}

/** The write check: creates 2 test issues (label pv-spike), links them, asks Jira's search again every 2 s for up to 10 s, deletes both. */
export async function runWriteCheck(call: ProbeCall, initiativeProject: string, epicProject: string, opts: { sleep?: Sleep; now?: () => number } = {}): Promise<CheckResult[]> {
  const steps = await probeInitiativeWrite(call, initiativeProject, epicProject, opts);
  return steps.map((s, n) => fromStep(s, n));
}

function fromStep(s: ProbeStep, n: number): CheckResult {
  const key = /^Delete /.test(s.label) ? `write_delete_${n}`
    : /^Create an? .* in /.test(s.label) ? "write_epic"
    : /^Create an? /.test(s.label) ? "write_initiative"
    : /^Set the Initiative/.test(s.label) ? "write_parent"
    : /^Read the parent/.test(s.label) ? "write_readback"
    : /^The children query/.test(s.label) ? "write_children"
    : `write_setup_${n}`;
  const ok = s.status >= 200 && s.status < 300;
  const failed = !ok || /nothing was written/i.test(s.note) || /matches: false/.test(s.note) || /^0 child\(ren\)/.test(s.note) || /NOT deleted/.test(s.note);
  const fix = failed ? (/NOT deleted/.test(s.note) ? "Delete the leftover test issue in Jira by hand (label pv-spike)." : /^0 child/.test(s.note) ? "Jira's search did not show the child within 10 seconds: run the test again; if it repeats, tell us." : "Fix the cause in Jira, then run the write test again.") : undefined;
  return res(key, s.label, failed ? "fail" : "pass", s.note.replace(/\n/g, " "), fix);
}

export const summarize = (checks: CheckResult[]) => ({ pass: checks.filter((c) => c.status === "pass").length, warn: checks.filter((c) => c.status === "warn").length, fail: checks.filter((c) => c.status === "fail").length });

export function reportText(kind: CheckKind, checks: CheckResult[], at?: string): string {
  const s = summarize(checks);
  return [`Jira ${kind === "write" ? "write" : "read-only"} checks${at ? ` · ${at}` : ""}: ${s.pass} pass · ${s.warn} warn · ${s.fail} fail`, ...checks.flatMap((c) => [`${c.status.toUpperCase().padEnd(4)} ${c.label}: ${c.reason}`, ...(c.fix ? [`     What to do: ${c.fix}`] : [])])].join("\n");
}
