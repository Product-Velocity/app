/** Rules of the early-access form on the public homepage (issue #498). Pure, so the server action and the tests share them. */
export const EA_ROLES = ["Product management", "Product leadership (VP, CPO)", "Engineering", "Design", "Operations", "Executive or business leadership", "Other"] as const;
export const EA_TEAMS = ["1", "2 to 5", "6 to 15", "16 or more"] as const;

export type EarlyAccessInput = { name: string; email: string; company: string; role: string; teams: string; website: string };
export type EarlyAccessErrors = Partial<Record<"name" | "email" | "company" | "role", string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v: FormDataEntryValue | null, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

export function readEarlyAccess(f: FormData): EarlyAccessInput {
  return { name: clean(f.get("name"), 120), email: clean(f.get("email"), 200).toLowerCase(), company: clean(f.get("company"), 160), role: clean(f.get("role"), 80), teams: clean(f.get("teams"), 20), website: clean(f.get("website"), 200) };
}

export function checkEarlyAccess(v: EarlyAccessInput): EarlyAccessErrors {
  const e: EarlyAccessErrors = {};
  if (!v.name) e.name = "Enter your name.";
  if (!EMAIL.test(v.email)) e.email = "Enter a work email address.";
  if (!v.company) e.company = "Enter your company name.";
  if (!(EA_ROLES as readonly string[]).includes(v.role)) e.role = "Choose the option closest to your role.";
  return e;
}

/** A visitor may send five requests an hour, counted per address and per network address. Best effort, per server instance. */
export function makeLimiter(limit = 5, windowMs = 60 * 60 * 1000, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const t = now();
    const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (recent.length >= limit) { hits.set(key, recent); return false; }
    recent.push(t); hits.set(key, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (v.every((x) => t - x >= windowMs)) hits.delete(k);
    return true;
  };
}
