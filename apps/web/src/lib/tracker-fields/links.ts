import type { Board } from "@pv/github";
import type { CatalogEntry } from "./catalog";
import { mappingRows, type Direction, type MappingRow, type Tracker } from "./slots";
import type { ChangeRowView, MappingView } from "./view";

// Which Product Velocity field each tracker field is linked to, and in which direction (decision 2026-11-11-tracker-field-table). The tracker's own field
// list is the starting point; this turns the mapping Sync really uses (the slots of slots.ts and the person's settings) into "tracker field -> Product
// Velocity fields". Pure: it reads the mapping view that the settings page already builds and decides nothing new. A tracker field that no slot names has
// no link and is ignored by Sync. Commercial fields (rule 2) have no slot and so can never appear here.

/** on: Sync uses it. off: a person switched it off. unset: the link exists but needs a choice first (for example no Jira priority is picked). partly: on in some projects only. */
export type LinkState = "on" | "off" | "unset" | "partly";
export type FieldLink = { pvKey: string; label: string; direction: Exclude<Direction, "never" | "not_synced">; state: LinkState; detail?: string };

/** What a person reads in the Direction column: per tracker field, the sum of its active links. */
export type RowDirection = "to_tracker" | "from_tracker" | "two_way" | "none";

export type LinkContext = { name: string; view: MappingView; board?: Board | null };
type Raw = FieldLink & { fieldId: string };

const isActive = (s: LinkState) => s === "on" || s === "partly";

/** The direction of one tracker field: both ways when any active link is compared both ways or sends and reads at once, "none" when nothing active. */
export function rowDirection(links: readonly FieldLink[]): RowDirection {
  const d = new Set(links.filter((l) => isActive(l.state)).map((l) => l.direction));
  if (d.size === 0) return "none";
  if (d.has("two_way") || (d.has("to_tracker") && d.has("from_tracker"))) return "two_way";
  return d.has("to_tracker") ? "to_tracker" : "from_tracker";
}

function jiraTargets(r: MappingRow, ch: ChangeRowView | undefined): { ids: string[]; state: LinkState; detail?: string } | null {
  const toggleOn = ch?.control.type === "toggle" ? ch.control.on : true;
  const s = r.slot;
  if (s) {
    if (s.id === "jira.summary") return { ids: ["summary"], state: "on" };
    if (s.id.startsWith("jira.body.") || s.id === "jira.description") return { ids: ["description"], state: toggleOn ? "on" : "off" };
    if (s.id.startsWith("jira.label.")) return { ids: ["labels"], state: toggleOn ? "on" : "off" };
    if (s.id === "jira.priority") {
      const c = ch?.control;
      const mapped = c?.type === "priority" && Object.values(c.values).some(Boolean);
      return { ids: ["priority"], state: mapped ? "on" : "unset", detail: mapped ? undefined : "no Jira priority chosen yet" };
    }
    if (s.id === "jira.startDate" || s.id === "jira.theme") {
      const v = ch?.control.type === "select" ? ch.control.value : "";
      return v ? { ids: [v], state: "on" } : null;
    }
    if (s.id === "jira.dueDate") {
      const v = ch?.control.type === "select" ? ch.control.value : "";
      return v === "__off" ? { ids: ["duedate"], state: "off" } : { ids: [v || "duedate"], state: "on" };
    }
    return null;
  }
  if (r.key === "status") return { ids: ["status"], state: "on" };
  if (r.key === "issues_total" || r.key === "issues_closed" || r.key === "delivery_progress_pct") return { ids: ["parent", "subtasks"], state: "on", detail: "counted from the children" };
  return null;
}

function githubTargets(r: MappingRow, ch: ChangeRowView | undefined, board: Board | null | undefined): { ids: string[]; state: LinkState; detail?: string } | null {
  const toggleOn = ch?.control.type === "toggle" ? ch.control.on : true;
  const s = r.slot;
  if (s) {
    if (s.id === "github.title" || s.id === "github.code") return { ids: ["title"], state: "on" };
    if (s.id.startsWith("github.body.")) return { ids: ["body"], state: toggleOn ? "on" : "off" };
    if (s.id.startsWith("github.label.")) return { ids: ["labels"], state: toggleOn ? "on" : "off" };
    if (s.id === "github.milestone") return { ids: ["milestone"], state: toggleOn ? "on" : "off" };
    if (s.id === "github.issueType") return { ids: ["type"], state: toggleOn ? "on" : "off" };
    const m = board?.mapping;
    const pick = s.id === "github.board.priority" ? m?.priority : s.id === "github.board.group" ? m?.group : s.id === "github.board.dueDate" ? m?.dueDate : s.id === "github.board.size" ? m?.size : undefined;
    return pick ? { ids: [pick.id], state: "on", detail: `board field in ${board?.title}` } : null;
  }
  if (r.key === "assignees") return { ids: ["assignees"], state: "on" };
  if (r.key === "gh_project_status" && board?.mapping.status) return { ids: [board.mapping.status.id], state: "on", detail: `board field in ${board.title}` };
  return null;
}

/**
 * Tracker field id -> its links, across the projects that use this connection (a Jira project is usually linked from one Product Velocity project; a GitHub
 * organisation from several). A link that is on in every project is "on", in none "off", in some "partly" with the projects named.
 */
export function trackerFieldLinks(tracker: Tracker, contexts: readonly LinkContext[]): Map<string, FieldLink[]> {
  const perContext: Raw[][] = contexts.map((c) => {
    const byId = new Map(c.view.changeable.map((r) => [r.id, r]));
    const out: Raw[] = [];
    for (const r of mappingRows(tracker)) {
      if (r.direction === "never" || r.direction === "not_synced") continue;
      const t = tracker === "jira" ? jiraTargets(r, r.slot ? byId.get(r.slot.id) : undefined) : githubTargets(r, r.slot ? byId.get(r.slot.id) : undefined, c.board);
      if (!t) continue;
      for (const fieldId of t.ids) out.push({ fieldId, pvKey: r.key, label: r.label, direction: r.direction, state: t.state, detail: t.detail });
    }
    return out;
  });
  const merged = new Map<string, FieldLink[]>();
  const seen = new Map<string, { link: FieldLink; on: string[]; off: string[]; unset: string[] }>();
  perContext.forEach((raws, i) => {
    for (const x of raws) {
      const k = `${x.fieldId}|${x.pvKey}|${x.direction}`;
      const slot = seen.get(k) ?? { link: { pvKey: x.pvKey, label: x.label, direction: x.direction as FieldLink["direction"], state: "on", detail: x.detail }, on: [], off: [], unset: [] };
      (x.state === "on" ? slot.on : x.state === "off" ? slot.off : slot.unset).push(contexts[i]?.name ?? "");
      seen.set(k, slot);
    }
  });
  for (const [k, v] of seen) {
    const fieldId = k.split("|")[0] ?? "";
    const all = v.on.length + v.off.length + v.unset.length;
    const state: LinkState = v.on.length === all ? "on" : v.on.length > 0 ? "partly" : v.off.length > 0 ? "off" : "unset";
    const detail = state === "partly" ? `on in ${v.on.join(", ")}` : v.link.detail;
    const list = merged.get(fieldId) ?? [];
    list.push({ ...v.link, state, detail });
    merged.set(fieldId, list);
  }
  return merged;
}

/** A catalog entry with what the table needs to search, filter and sort it. Plain data, so a client component can take it. */
export type TableRow = CatalogEntry & { links: FieldLink[]; direction: RowDirection };

export function tableRows(entries: readonly CatalogEntry[], links: ReadonlyMap<string, FieldLink[]>): TableRow[] {
  return entries.map((e) => {
    const l = links.get(e.id) ?? [];
    return { ...e, links: l, direction: rowDirection(l) };
  });
}
