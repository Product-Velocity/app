import type { Lookups, LookupPerson } from "./types";

/** Who a person field can name. Falls back to the members when a caller has no directory (the id of a member is their user id). */
export function peopleOf(lookups: Pick<Lookups, "members" | "people">): LookupPerson[] {
  return lookups.people ?? lookups.members.map((m) => ({ id: m.user_id, name: m.email, email: m.email, status: "active" as const, userId: m.user_id }));
}

/** The words of a picker option: someone without an account says so, so nobody mistakes them for a member. */
export function personLabel(p: LookupPerson): string {
  return p.status === "active" ? p.name : `${p.name} (${p.status === "invited" ? "invited" : "not invited"})`;
}

/** Picker options for a person field. */
export function personOptions(lookups: Pick<Lookups, "members" | "people">): { value: string; label: string }[] {
  return peopleOf(lookups).map((p) => ({ value: p.id, label: personLabel(p) }));
}

/** The name of a person for a cell, a report row or a tooltip. */
export function personName(lookups: Pick<Lookups, "members" | "people">, id: unknown, fallback = "unknown person"): string {
  return peopleOf(lookups).find((p) => p.id === id)?.name ?? fallback;
}
