/** Naming someone who is not a member yet (issue #691): what a typed line in a person picker means. */
export type PersonInput = { name: string; firstName: string; lastName: string | null; email: string | null };

/**
 * First and last name from one typed name: "Last, First" when there is a comma, otherwise the first word is the first name and the rest the
 * last name; one word is a first name only. Never guessed from an email address. The database applies the same rule (split_person_name).
 */
export function splitFullName(full: string): { firstName: string; lastName: string | null } {
  const n = full.replace(/\s+/g, " ").trim();
  const comma = n.indexOf(",");
  if (comma >= 0) {
    const first = n.slice(comma + 1).trim();
    const last = n.slice(0, comma).trim();
    if (first) return { firstName: first, lastName: last || null };
    return { firstName: last, lastName: null };
  }
  const space = n.indexOf(" ");
  return space < 0 ? { firstName: n, lastName: null } : { firstName: n.slice(0, space), lastName: n.slice(space + 1).trim() || null };
}

const EMAIL = /^[^@\s<>,;]+@[^@\s<>,;]+$/;

/** "Ravi Rao <ravi@x.com>", "Ravi Rao, ravi@x.com", "ravi.rao@x.com" or just "Ravi Rao". Null when there is no usable name. */
export function parsePersonInput(raw: string): PersonInput | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text === "") return null;
  let name = text;
  let email: string | null = null;
  const angle = /^(.*?)\s*<([^<>\s]+)>$/.exec(text);
  if (angle && EMAIL.test(angle[2]!)) { name = angle[1]!.trim(); email = angle[2]!; }
  else if (EMAIL.test(text)) { email = text; name = ""; }
  else {
    const cut = Math.max(text.lastIndexOf(","), text.lastIndexOf(";"));
    if (cut > 0 && EMAIL.test(text.slice(cut + 1).trim())) { name = text.slice(0, cut).trim(); email = text.slice(cut + 1).trim(); }
  }
  if (email) email = email.toLowerCase();
  if (name === "" && email) name = nameFromEmail(email);
  name = name.replace(/^["']|["']$/g, "").trim();
  const { firstName, lastName } = splitFullName(name);
  if (firstName.length < 1 || firstName.length > 60 || (lastName ?? "").length > 60) return null;
  return { name: lastName ? `${firstName} ${lastName}` : firstName, firstName, lastName, email };
}

/** A readable name for an address that came without one: jane.doe+x@y.com becomes Jane Doe. */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0]!.split("+")[0]!;
  const words = local.split(/[._-]+/).filter(Boolean);
  return (words.length ? words : [local]).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** The directory entry a typed line names: the same name or address (any case), or null when it is someone new. */
export function findPerson<T extends { id: string; name: string; email?: string | null }>(people: readonly T[], input: PersonInput): T | null {
  const n = input.name.toLowerCase();
  return people.find((p) => (input.email !== null && (p.email ?? "").toLowerCase() === input.email) || p.name.toLowerCase() === n) ?? null;
}
