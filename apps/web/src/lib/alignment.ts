/** Pure rules of alignment session setup (issue #123), kept apart from the forms so they can be tested. */

export const METHODS = [
  { value: "top5_duels", label: "Top 5, then duels", help: "Each person picks their five most important initiatives, then settles close calls in head-to-head duels." },
  { value: "coins", label: "100 coins", help: "Each person spends coins across the initiatives, with a maximum per initiative." },
  { value: "ice", label: "ICE sliders", help: "Each person scores impact, confidence and ease for every initiative with sliders." },
] as const;
export type Method = (typeof METHODS)[number]["value"];
export const STATES = ["draft", "open", "closed", "archived"] as const;
export type SessionState = (typeof STATES)[number];
export const STATE_LABEL: Record<SessionState, string> = { draft: "Draft", open: "Open", closed: "Closed", archived: "Archived" };

export type Group = { id: string; name: string };

/** One group name per line becomes the groups of the session; ids are stable slugs; duplicates and blanks are dropped. */
export function parseGroups(text: string): Group[] | { error: string } {
  const seen = new Set<string>();
  const out: Group[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const name = raw.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!name) continue;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "group";
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name });
  }
  if (out.length === 0) return { error: "Add at least one group, for example Everyone." };
  if (out.length > 12) return { error: "Use at most 12 groups." };
  return out;
}
export const groupsToText = (groups: Group[]) => groups.map((g) => g.name).join("\n");

export type Settings = {
  name: string; method: Method; groups: Group[]; weighting: "equal" | "headcount"; excluded: string[];
  coinsTotal: number; coinsMax: number; showResults: boolean; retentionMonths: number; closesAt: string | null;
};
export type SettingsResult = { ok: true; settings: Settings } | { ok: false; error: string };

export function validateSettings(i: { name: unknown; method: unknown; groups: unknown; weighting: unknown; excluded: unknown; coinsTotal: unknown; coinsMax: unknown; showResults: unknown; retention: unknown; closesAt: unknown }, now = Date.now()): SettingsResult {
  const name = String(i.name ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 120) return { ok: false, error: "Give the session a name of up to 120 characters." };
  const method = String(i.method ?? "") as Method;
  if (!METHODS.some((m) => m.value === method)) return { ok: false, error: "Choose a method." };
  const groups = parseGroups(String(i.groups ?? ""));
  if ("error" in groups) return { ok: false, error: groups.error };
  const weighting = i.weighting === "headcount" ? "headcount" : "equal";
  const excluded = (Array.isArray(i.excluded) ? i.excluded : []).map(String).filter((x) => groups.some((g) => g.id === x));
  if (excluded.length >= groups.length) return { ok: false, error: "At least one group must count in the joint score." };
  const coinsTotal = Number(i.coinsTotal), coinsMax = Number(i.coinsMax);
  if (!Number.isInteger(coinsTotal) || coinsTotal < 10 || coinsTotal > 1000) return { ok: false, error: "Coins per person must be a whole number from 10 to 1000." };
  if (!Number.isInteger(coinsMax) || coinsMax < 1 || coinsMax > coinsTotal) return { ok: false, error: "The maximum per initiative must be at least 1 and no more than the coins per person." };
  const retentionMonths = Number(i.retention);
  if (!Number.isInteger(retentionMonths) || retentionMonths < 1 || retentionMonths > 120) return { ok: false, error: "Keep personal data for 1 to 120 months." };
  let closesAt: string | null = null;
  const raw = String(i.closesAt ?? "").trim();
  if (raw) {
    const t = Date.parse(raw);
    if (Number.isNaN(t)) return { ok: false, error: "The closing time is not a date and time." };
    if (t <= now) return { ok: false, error: "The closing time must be in the future." };
    closesAt = new Date(t).toISOString();
  }
  return { ok: true, settings: { name, method, groups, weighting, excluded, coinsTotal, coinsMax, showResults: i.showResults === true || i.showResults === "on", retentionMonths, closesAt } };
}

/** What may be done to a session in each state (all are admin-only; the database enforces the order). */
export const NEXT_STATE: Record<SessionState, { to: SessionState; label: string; confirm: string } | null> = {
  draft: { to: "open", label: "Open the session", confirm: "Opening locks the settings and fixes what participants will see. To change them you would need a new session." },
  open: { to: "closed", label: "Close the session", confirm: "Closing ends voting. Nobody can change a vote afterwards." },
  closed: { to: "archived", label: "Archive", confirm: "Archived sessions are kept for the record and cannot be reopened." },
  archived: null,
};

/** The text participants see about who can see their answers (docs/19 section 4 and 7). */
export const CONSENT_LINES = [
  "We collect your email address, your group and your answers.",
  "Your answers are combined into anonymous results. Other participants never see your answers.",
  "Workspace admins can see who gave which answers.",
  "Your personal data is deleted after the retention period; the anonymous results stay.",
];
