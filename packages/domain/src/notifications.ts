import { GATES, outcomeLabel, type GateId } from "./gates";

/**
 * Gate notifications (issue #341, docs/decisions/2026-11-05-gate-notifications.md): the in-app inbox. The database writes the rows (triggers on
 * `gate_reviews`); this file says what a row reads like and where it leads. A row holds the initiative code and name and the gate, never a rationale.
 */
export type NotificationKind = "gate_requested" | "gate_decided" | "gate_withdrawn";
export type AppNotification = {
  id: string; kind: NotificationKind; item_id: string | null; review_id: string | null; created_at: string; read_at: string | null;
  payload: { gate?: GateId; item_code?: string; item_name?: string; outcome?: string; fast_lane?: boolean; ready?: boolean };
};

const what = (n: AppNotification) => `${n.payload.item_code ?? "An initiative"}${n.payload.item_name ? ` ${n.payload.item_name}` : ""}`;
const gateText = (n: AppNotification) => (n.payload.gate && GATES[n.payload.gate] ? `gate ${n.payload.gate} (${GATES[n.payload.gate].from} to ${GATES[n.payload.gate].to})` : "a gate");

/** One line, text only (a notification never relies on colour). */
export function notificationText(n: AppNotification): string {
  if (n.kind === "gate_requested") return `${what(n)} asks for a decision on ${gateText(n)}.`;
  if (n.kind === "gate_withdrawn") return `The request for ${gateText(n)} on ${what(n)} was withdrawn because the initiative moved.`;
  const o = outcomeLabel(n.payload.outcome);
  return `${what(n)}: ${gateText(n)} was decided: ${o}${n.payload.fast_lane ? " (fast lane)" : ""}.`;
}

/** Where a click leads: a request to Decisions (to decide it), everything else to the initiative. */
export function notificationTarget(n: AppNotification): { kind: "decisions" } | { kind: "item"; code: string } | null {
  if (n.kind === "gate_requested") return { kind: "decisions" };
  return n.payload.item_code ? { kind: "item", code: n.payload.item_code } : null;
}

export const unreadCount = (list: readonly AppNotification[]) => list.filter((n) => n.read_at === null).length;
/** Newest first, unread before read within the same day is not needed: plain newest first. */
export const sortNotifications = (list: readonly AppNotification[]) => [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
