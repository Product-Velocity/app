/** Naming someone who is not a member yet (issue #691): what a typed line in a person picker means. */
export type PersonInput = { name: string; email: string | null };

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
  if (name.length < 1 || name.length > 120) return null;
  return { name, email };
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
