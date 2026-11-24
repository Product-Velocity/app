/**
 * The new-person wizard (issue #634): the steps, what "About you" accepts, which workspaces a person has finished setting up, and the
 * "Get started" checklist on the roadmap. Per-person answers live in the person's own profile (Supabase user metadata), never in
 * workspace data, so no table and no tenant data is involved.
 */

export const WIZARD_STEPS = [
  { key: "workspace", label: "Workspace" },
  { key: "about", label: "About you" },
  { key: "invite", label: "Team" },
  { key: "connect", label: "Connect" },
] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number]["key"] | "invited-welcome";

/** The same frame for someone who joined through an invitation: the invitation is done, the welcome is the one screen left. */
export const INVITED_STEPS = [
  { key: "invitation", label: "Invitation" },
  { key: "invited-welcome", label: "Welcome" },
] as const;

/** What happens after a person opens an invitation link, shown on the invitation page so nothing is a surprise. */
export const INVITE_STEPS = [
  { title: "Sign in or create your account", text: "Use the email address the invitation was sent to." },
  { title: "Accept the invitation", text: "You join the workspace with the role shown above." },
  { title: "A one-minute welcome", text: "See how the roadmap works and how you can help, then open it." },
] as const;

/** First things to try after joining, by what the role can do. Nothing here promises more than the role's own description. */
export function firstThings(canEdit: boolean): { title: string; text: string }[] {
  return [
    { title: "Read the roadmap", text: "One stack rank for everything the team is building, with the reason behind each item." },
    { title: "Click a row to peek", text: "The side panel shows an item's details without leaving the roadmap." },
    { title: "Press ⌘K", text: "Jump to any item or screen from the keyboard." },
    ...(canEdit ? [{ title: "Add an item fast", text: "Type a name in the top row and press Enter. Details can wait." }] : []),
  ];
}

export const ROLE_OPTIONS = ["Product manager", "Product leader", "Engineering lead", "Designer", "Founder", "Other"] as const;
export const GOAL_OPTIONS = [
  "Prioritise one roadmap",
  "Align stakeholders and customers",
  "Plan around team capacity",
  "Sync with GitHub or Jira",
  "Report to leadership",
] as const;

export type AboutYou = { firstName: string; lastName: string; fullName: string; role: string; goal: string };
export type AboutResult = { ok: true; value: AboutYou } | { ok: false; error: string };

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * First name and last name are asked separately and kept both ways: first_name and last_name, and the joined full_name the rest of the app
 * uses. Skipping the step is free, but a person who fills it in gives a first name (emails greet by it). A role or goal must be one of the
 * listed choices; each name is at most 60 characters.
 */
export function parseAboutYou(input: { firstName?: unknown; lastName?: unknown; role?: unknown; goal?: unknown }): AboutResult {
  const firstName = clean(input.firstName);
  const lastName = clean(input.lastName);
  if (!firstName) return { ok: false, error: "Enter your first name, or choose Skip for now." };
  if (firstName.length > 60 || lastName.length > 60) return { ok: false, error: "Each name can have up to 60 characters." };
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const role = clean(input.role);
  if (role && !(ROLE_OPTIONS as readonly string[]).includes(role)) return { ok: false, error: "Choose a role from the list." };
  const goal = clean(input.goal);
  if (goal && !(GOAL_OPTIONS as readonly string[]).includes(goal)) return { ok: false, error: "Choose from the list." };
  return { ok: true, value: { firstName, lastName, fullName, role, goal } };
}

type Meta = Record<string, unknown> | null | undefined;

/** Workspaces the person has finished the wizard for. The owner notice goes out once per workspace, the first time it is added. */
export function onboardedTenants(meta: Meta): string[] {
  const v = meta?.onboarded_tenants;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
export const hasFinishedOnboarding = (meta: Meta, tenantId: string) => onboardedTenants(meta).includes(tenantId);
export const withOnboarded = (meta: Meta, tenantId: string): string[] => (hasFinishedOnboarding(meta, tenantId) ? onboardedTenants(meta) : [...onboardedTenants(meta), tenantId]);

/** Workspaces whose "Get started" card the person closed. */
export function dismissedChecklists(meta: Meta): string[] {
  const v = meta?.checklist_dismissed;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
export const checklistDismissed = (meta: Meta, tenantId: string) => dismissedChecklists(meta).includes(tenantId);

export type ChecklistCounts = { projects: number; members: number; pendingInvites: number; items: number; trackers: number };
export type ChecklistItem = { key: string; label: string; hint: string; /** No link: the step is done inside the roadmap itself. */ href: string | null; /** A second link for the same step, for tracker parity (GitHub and Jira are equals). */ altHref?: string; altLabel?: string; done: boolean };

/**
 * The steps the app can see for itself, in the order they must happen: a project first (every initiative belongs to one), then the first
 * initiative, the team and a tracker. One list, so setting up a workspace and creating the first initiative read as one path. Connecting
 * Claude and Help are links, not tracked.
 */
export function checklist(c: ChecklistCounts): { items: ChecklistItem[]; done: number } {
  const items: ChecklistItem[] = [
    { key: "project", label: "Create your first project", hint: "Every initiative belongs to a project. Open \u201cAll projects\u201d at the top and choose + New project.", href: null, done: c.projects > 0 },
    { key: "item", label: "Add your first initiative", hint: "Type a name in the quick-add row and press Enter.", href: "/portfolio", done: c.items > 0 },
    { key: "invite", label: "Invite your team", hint: "Nothing is sent until you confirm.", href: "/settings/members", done: c.members > 1 || c.pendingInvites > 0 },
    { key: "tracker", label: "Connect GitHub", altLabel: "Jira", hint: "Two-way sync of the work your engineers do.", href: "/settings/integrations/github", altHref: "/settings/integrations/jira", done: c.trackers > 0 },
  ];
  return { items, done: items.filter((i) => i.done).length };
}

/** Show the card until the person closes it or has done every step. */
export const showChecklist = (meta: Meta, tenantId: string, c: ChecklistCounts) => { const l = checklist(c); return !checklistDismissed(meta, tenantId) && l.done < l.items.length; };

/** The connections offered on the last wizard step. GitHub and Jira are shown as equals; each opens its own settings screen. */
export const CONNECT_CARDS = [
  { key: "github", title: "GitHub", text: "Two-way sync of issues and pull requests with your roadmap.", href: "/settings/integrations/github", newTab: false },
  { key: "jira", title: "Jira", text: "Two-way sync of Jira work with your roadmap.", href: "/settings/integrations/jira", newTab: false },
  { key: "claude", title: "Claude and other AI assistants", text: "Let your AI co-worker read the roadmap and prepare work. It never approves.", href: "/settings/claude", newTab: false },
] as const;

/**
 * Prefill for the name fields: what onboarding stored, else what Google or GitHub gave (given_name and family_name, or the first word and the
 * rest of the full name). Empty when nothing is known.
 */
export function splitName(meta: Meta): { first: string; last: string } {
  const str = (k: string) => (typeof meta?.[k] === "string" ? (meta[k] as string).trim() : "");
  if (str("first_name")) return { first: str("first_name"), last: str("last_name") };
  if (str("given_name")) return { first: str("given_name"), last: str("family_name") };
  const full = str("full_name") || str("name");
  const [first = "", ...rest] = full.split(/\s+/).filter(Boolean);
  return { first, last: rest.join(" ") };
}
