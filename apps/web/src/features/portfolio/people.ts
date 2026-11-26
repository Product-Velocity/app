import type { Lookups, LookupPerson, PersonStatus } from "./types";

type Source = Pick<Lookups, "members" | "people">;

/** Members who cannot be chosen any more: their name stays on what they are on, and in reports, but pickers do not offer them. */
const NOT_OFFERED = new Set<PersonStatus>(["paused", "revoked", "requested"]);
const STATUS_WORD: Partial<Record<PersonStatus, string>> = { invited: "invited", not_invited: "not invited", paused: "paused", revoked: "revoked", requested: "requested access" };

/** Everyone a person field can show by name. Falls back to the members when a caller has no directory (the id of a member is their user id). */
export function peopleOf(lookups: Source): LookupPerson[] {
  return lookups.people ?? lookups.members.map((m) => ({ id: m.user_id, name: m.email, email: m.email, status: "active" as const, userId: m.user_id }));
}

/** Who a picker, quick add, a paste import or Claude may set on an initiative: not someone who is paused, revoked or has only asked for access. */
export function selectablePeople(lookups: Source): LookupPerson[] {
  return peopleOf(lookups).filter((p) => !NOT_OFFERED.has(p.status));
}

/**
 * The words of a picker option: "Name, email" (so two people with the same name can be told apart), and anyone who is not an active member
 * says so, so nobody mistakes them for one. A person with no name of their own shows the email once. Cells, cards and reports show the name only.
 */
export function personLabel(p: LookupPerson): string {
  const who = p.email && p.email.toLowerCase() !== p.name.toLowerCase() ? `${p.name}, ${p.email}` : p.name;
  const word = STATUS_WORD[p.status];
  return word ? `${who} (${word})` : who;
}

/** The people a typed `@name` or a pasted Person cell may name: members and people named without an account, with their email to match by. */
export function matchablePeople(lookups: Source): { id: string; name: string; email: string | null }[] {
  return selectablePeople(lookups).map((p) => ({ id: p.id, name: p.name, email: p.email }));
}

/** Picker options for a person field. `all` also lists members who are paused or revoked (a filter or a report may want a former product manager). */
export function personOptions(lookups: Source, opts: { all?: boolean } = {}): { value: string; label: string }[] {
  return (opts.all ? peopleOf(lookups) : selectablePeople(lookups)).map((p) => ({ value: p.id, label: personLabel(p) }));
}

/** The name of a person for a cell, a report row or a tooltip. */
export function personName(lookups: Source, id: unknown, fallback = "unknown person"): string {
  return peopleOf(lookups).find((p) => p.id === id)?.name ?? fallback;
}
