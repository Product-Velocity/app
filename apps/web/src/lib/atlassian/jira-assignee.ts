import { withBackoff, type JiraRequest } from "./jira-write";
import { createAdminClient } from "@/lib/supabase/admin";

// The Product Manager as the Jira assignee of a NEW issue (issue 733, Ashu 2026-11-27): set when the issue is created and never again, so people can
// reassign it in Jira and Sync never takes it back. The match is by email through Jira's user search (a read). The email is read on the server for this one
// lookup; it is never logged, never put in a note or a preview, and never sent anywhere but Jira's own user search. A failed or unclear match only leaves
// the assignee empty and says why (Jira's account ids are personal data: none is stored; docs/14-GO-LIVE-CHECKLIST.md).

export type AssigneeLookup = { ok: true; accountId: string; name: string } | { ok: false; note: string };
const NOT_SET = "Assignee not set:";
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null ? (v as Obj) : {});
const plain = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

/** The one active Jira user whose email is this address. A hidden email (Jira privacy settings) is accepted only when the search finds exactly one user. */
export async function findJiraAccount(call: JiraRequest, email: string): Promise<AssigneeLookup> {
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, note: `${NOT_SET} the Product Manager has no usable email address.` };
  let r: Awaited<ReturnType<JiraRequest>>;
  try {
    r = await withBackoff(() => call("GET", `/user/search?query=${encodeURIComponent(email)}&maxResults=5`));
  } catch {
    return { ok: false, note: `${NOT_SET} Jira could not be asked just now. It is only set when the issue is created.` };
  }
  if (r.status === 401 || r.status === 403) return { ok: false, note: `${NOT_SET} the Jira connection may not look up users (it needs permission to browse users).` };
  if (r.status !== 200 || !Array.isArray(r.json)) return { ok: false, note: `${NOT_SET} Jira could not be asked just now.` };
  const people = (r.json as unknown[]).map(obj).filter((u) => typeof u.accountId === "string" && u.active !== false && (u.accountType === undefined || u.accountType === "atlassian"));
  const exact = people.filter((u) => typeof u.emailAddress === "string" && u.emailAddress.toLowerCase() === email.toLowerCase());
  const hidden = people.filter((u) => typeof u.emailAddress !== "string");
  const found = exact.length > 0 ? exact : hidden.length === people.length ? hidden : [];
  if (found.length === 0) return { ok: false, note: `${NOT_SET} Jira has no user with the Product Manager's email address.` };
  if (found.length > 1) return { ok: false, note: `${NOT_SET} more than one Jira user matches the Product Manager.` };
  const u = found[0]!;
  return { ok: true, accountId: String(u.accountId).slice(0, 128), name: plain(u.displayName, 60) || "the Product Manager" };
}

/** The Product Manager's email, for a member of this workspace only (null for anyone else, or when it cannot be read). */
export async function productManagerEmail(tenantId: string, userId: string): Promise<string | null> {
  try {
    const admin = createAdminClient({ via: "UI" });
    const { data: member } = await admin.from("tenant_members").select("user_id").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
    if (!member) return null;
    const { data } = await admin.auth.admin.getUserById(userId);
    const email = data?.user?.email;
    return typeof email === "string" && email !== "" ? email : null;
  } catch {
    return null;
  }
}

/** Adds the assignee to the fields of a create, and says in the preview what happened. Never throws. */
export async function addAssignee(plan: { fields: Record<string, unknown>; notes: string[] }, call: JiraRequest, pm: { email: string | null; none: boolean }): Promise<void> {
  if (pm.none) { plan.notes.push(`${NOT_SET} this initiative has no Product Manager.`); return; }
  if (!pm.email) { plan.notes.push(`${NOT_SET} the Product Manager's email address could not be read.`); return; }
  const a = await findJiraAccount(call, pm.email);
  if (!a.ok) { plan.notes.push(a.note); return; }
  plan.fields.assignee = { accountId: a.accountId };
  plan.notes.push(`Assignee: ${a.name} (the Product Manager), set only when the issue is created. Changing it in Jira is never undone by Sync.`);
}
