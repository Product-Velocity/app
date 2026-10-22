export const MIN_PASSWORD_LENGTH = 10;

export type Requirement = { id: "length" | "mix" | "common"; label: string; met: boolean };
export type StrengthLabel = "Too weak" | "Fair" | "Good" | "Strong";
export type PasswordCheck = {
  /** All requirements met: the password may be used. */
  ok: boolean;
  requirements: Requirement[];
  strength: { score: 0 | 1 | 2 | 3; label: StrengthLabel };
};

// Whole passwords that are known to be guessed first (compared in lower case).
const COMMON = new Set([
  "password", "passw0rd", "p@ssword", "p@ssw0rd", "qwertyuiop", "qwerty123", "qwerty12345", "1234567890",
  "12345678910", "0123456789", "0987654321", "abcdefghij", "abcd1234", "letmein123", "iloveyou123",
  "admin12345", "administrator", "welcome123", "changeme123", "trustno1234", "baseball123", "football123",
  "1q2w3e4r5t", "1qaz2wsx3edc", "zaq12wsxcde", "asdfghjkl1", "qazwsxedc123",
]);
// Words people build "strong" passwords from; "Password123!" is still Password.
const COMMON_ROOTS = [
  "password", "passw0rd", "qwerty", "letmein", "welcome", "admin", "iloveyou", "changeme", "football",
  "baseball", "monkey", "dragon", "princess", "sunshine", "master", "login", "abc123", "trustno1",
  "starwars", "superman", "batman", "shadow", "hello123", "123456",
];

const unleet = (s: string) =>
  s.replace(/@/g, "a").replace(/\$/g, "s").replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/!/g, "i");

function isCommon(pw: string): boolean {
  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) return true;
  const plain = unleet(lower).replace(/[^a-z]/g, "");
  for (const root of COMMON_ROOTS) {
    // the common word plus a few extra characters (digits, a year, "!") is still that word
    if ((lower.includes(root) || plain.includes(unleet(root).replace(/[^a-z]/g, ""))) && pw.length <= root.length + 6) {
      return true;
    }
  }
  return /^(\d)\1+$/.test(lower) || "01234567890123456789".includes(lower) || "9876543210987654321".includes(lower);
}

function containsEmailName(pw: string, email?: string): boolean {
  const local = email?.split("@")[0]?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
  const lower = pw.toLowerCase().replace(/[^a-z0-9]/g, "");
  // pieces of the address such as "ashu" and "mathura" from ashu.mathura@..., 4+ letters each
  const parts = (email?.split("@")[0]?.toLowerCase().split(/[^a-z0-9]+/) ?? []).filter((p) => p.length >= 4);
  return (local.length >= 4 && lower.includes(local)) || parts.some((p) => lower.includes(p));
}

function classCount(pw: string): number {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(pw)).length;
}

function strengthOf(pw: string, ok: boolean): PasswordCheck["strength"] {
  if (!ok) return { score: 0, label: "Too weak" };
  const unique = new Set(pw).size;
  const effectiveLength = Math.min(pw.length, unique * 2); // repeats add little
  const pool =
    (/[a-z]/.test(pw) ? 26 : 0) + (/[A-Z]/.test(pw) ? 26 : 0) + (/[0-9]/.test(pw) ? 10 : 0) + (/[^a-zA-Z0-9]/.test(pw) ? 33 : 0);
  const bits = effectiveLength * Math.log2(Math.max(pool, 2));
  if (bits >= 80) return { score: 3, label: "Strong" };
  if (bits >= 60) return { score: 2, label: "Good" };
  return { score: 1, label: "Fair" };
}

/** Same rules in the browser (live checklist) and on the server (enforced). */
export function checkPassword(pw: string, opts: { email?: string } = {}): PasswordCheck {
  const empty = pw.length === 0;
  const lengthMet = pw.length >= MIN_PASSWORD_LENGTH;
  const mixMet = classCount(pw) >= 2;
  const commonMet =
    !empty && new Set(pw).size >= 6 && !isCommon(pw) && !containsEmailName(pw, opts.email);

  const requirements: Requirement[] = [
    { id: "length", label: `At least ${MIN_PASSWORD_LENGTH} characters`, met: lengthMet },
    { id: "mix", label: "Mixes at least 2 of: lowercase, uppercase, numbers, symbols (a space counts)", met: mixMet },
    { id: "common", label: "Not a common password, not part of your email, not a repeating pattern", met: commonMet },
  ];
  const ok = requirements.every((r) => r.met);
  return { ok, requirements, strength: strengthOf(pw, ok) };
}
