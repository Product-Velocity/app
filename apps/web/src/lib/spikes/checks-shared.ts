// THROWAWAY spike code for issue #30. Pure helpers shared by the server checks and the browser console.
export type Verdict = "pass" | "fail" | "info" | "manual";
export type CheckResult = { id: string; title: string; verdict: Verdict; summary: string; fix?: string; evidence?: unknown };

export const CHECKS = [
  { id: "connection", title: "App credentials, installation and permissions" },
  { id: "issue-types", title: "Issue types (is Epic available?)" },
  { id: "s4b", title: "S4b: sub-issue hierarchy and depth" },
  { id: "s2b", title: "S2b: organisation Project (read, add item, write dates, read back)" },
  { id: "s3b", title: "S3b: issue fields (discovery)" },
  { id: "webhooks", title: "S2b/S5b: webhook deliveries reaching the app" },
  { id: "s5b", title: "S5b: install request by a non-owner (manual step)" },
] as const;

const NOISE = /(^|_)url$|^node_id$|^gravatar_id$|^reactions$|^repository$|^owner$|^user$|^organization$|^performed_via_github_app$/;

/** Drops URL and avatar noise so evidence stays short enough to paste. */
export function compact(v: unknown): unknown {
  if (Array.isArray(v)) return v.slice(0, 25).map(compact);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) if (!NOISE.test(k)) out[k] = compact(val);
    return out;
  }
  return v;
}

const RANK: Record<string, number> = { read: 1, write: 2, admin: 3 };

/** Human-readable list of permissions that are missing or too weak. */
export function permissionGaps(have: Record<string, string> | undefined, need: Record<string, "read" | "write">): string[] {
  return Object.entries(need)
    .filter(([k, level]) => (RANK[have?.[k] ?? ""] ?? 0) < RANK[level]!)
    .map(([k, level]) => `${k} (needs ${level}, has ${have?.[k] ?? "none"})`);
}

/** Plain-language fix for a failed GitHub call. */
export function fixFor(status: number, message: string | undefined, neededPermission?: string): string {
  if (status === 401) {
    return "GitHub rejected the App credentials. Check GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_B64 in Vercel (Settings > Environment Variables), then redeploy.";
  }
  if (status === 403 && /not accessible by integration/i.test(message ?? "")) {
    return `The App lacks a permission${neededPermission ? ` (GitHub says it needs: ${neededPermission})` : ""}. Add it in the App's settings (Permissions & events), save, then accept the update on the installation page as an org owner.`;
  }
  if (status === 403) return `Forbidden: ${message ?? "no message"}. Rate limit or a policy block; wait a minute and retry.`;
  if (status === 404) return "Not found: the App may not be installed on this repo or org, the path may be wrong, or the feature may not exist on this plan.";
  if (status === 422) return `GitHub rejected the request as invalid: ${message ?? "see evidence"}.`;
  return `Unexpected response ${status}: ${message ?? "no message"}.`;
}

export type Delivery = { event?: string; action?: string | null; status_code?: number; delivered_at?: string };

/** Counts deliveries per event/action and status code. */
export function summariseDeliveries(list: Delivery[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of list) {
    const key = `${d.event ?? "?"}/${d.action ?? "-"} -> ${d.status_code ?? "?"}`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

export function reportMarkdown(results: CheckResult[]): string {
  const lines = ["# GitHub sandbox spike report (#30)", ""];
  for (const r of results) {
    lines.push(`## ${r.verdict.toUpperCase()}: ${r.title}`, r.summary);
    if (r.fix) lines.push("", `Fix: ${r.fix}`);
    if (r.evidence !== undefined) lines.push("", "```json", JSON.stringify(r.evidence, null, 1), "```");
    lines.push("");
  }
  return lines.join("\n");
}
