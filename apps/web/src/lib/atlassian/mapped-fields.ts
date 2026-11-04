import { getJson } from "./read-client";
import type { JiraRequest } from "./jira-write";
import type { JiraField } from "./field-catalog";
import type { JiraFieldMap } from "./outbound";

// Before a Sync plan is made, the custom fields the field configuration names are checked against the site's fields NOW (decision
// 2026-11-03-tracker-field-config). A field that is gone (deleted, or the admin lost access) is left out of the payload and the preview says so:
// the alternative is Jira refusing the whole write of that initiative. A site whose fields can not be read just now is left as it is.

const LABELS: [keyof Pick<JiraFieldMap, "startDate" | "theme" | "dueDate">, string][] = [["startDate", "Start date"], ["theme", "Theme"], ["dueDate", "Due date"]];

/** One read of a site's field ids serves a whole Sync preview (a site has about 200 fields; a preview checks every initiative). */
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; ids: Set<string> }>();

export async function dropMissingFields(call: JiraRequest, map: JiraFieldMap, opts: { cacheKey?: string; now?: () => number } = {}): Promise<{ map: JiraFieldMap; notes: string[] }> {
  const custom = LABELS.filter(([k]) => typeof map[k] === "string" && (map[k] as string).startsWith("customfield_"));
  if (custom.length === 0) return { map, notes: [] };
  let ids: Set<string>;
  const now = (opts.now ?? Date.now)();
  const hit = opts.cacheKey ? cache.get(opts.cacheKey) : undefined;
  try {
    if (hit && now - hit.at < CACHE_MS) ids = hit.ids;
    else {
      ids = new Set((await getJson<JiraField[]>(call, "/field")).map((f) => f.id));
      if (opts.cacheKey) cache.set(opts.cacheKey, { at: now, ids });
    }
  } catch {
    return { map, notes: [] }; // fields unreadable: ReconnectNeeded and the like are reported by the read of the issue itself
  }
  const out: JiraFieldMap = { ...map };
  const notes: string[] = [];
  for (const [k, label] of custom) {
    const id = map[k] as string;
    if (ids.has(id)) continue;
    delete out[k];
    if (k === "dueDate") out.off = [...(out.off ?? []), "jira.dueDate"];
    notes.push(`${label} not sent: the Jira field ${id} no longer exists on this site. Choose another one in the field configuration.`);
  }
  return { map: out, notes };
}
