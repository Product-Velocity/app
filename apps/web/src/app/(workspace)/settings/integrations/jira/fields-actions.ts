"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { validateJiraMapping, type JiraKind } from "@pv/domain";
import { parseCatalogRows } from "@/lib/atlassian/field-mappings";
import { refreshFieldCatalog } from "@/lib/atlassian/refresh-fields";
import { ReconnectNeeded } from "@/lib/atlassian/token-provider";
import { requireWorkspace } from "@/lib/session";

// The Fields section of a linked Jira project (issues #69, #70): read the catalog, map a Jira field to a PV field, remove a mapping.
// Human admins only (never a service account or platform staff); the database checks it again and validates every pair.
const PATH = "/settings/integrations/jira";

async function adminOnly() {
  const ctx = await requireWorkspace(PATH);
  const { data: me } = await ctx.supabase.from("tenant_members").select("is_service_account").eq("tenant_id", ctx.active.tenantId).eq("user_id", ctx.user.id).maybeSingle();
  if (ctx.active.role !== "admin" || me?.is_service_account || ctx.active.platform) return null;
  return ctx;
}
const back = (status: string, project: string): never => {
  revalidatePath(PATH);
  redirect(`${PATH}?status=${status}&fp=${encodeURIComponent(project)}`);
};
const isRedirect = (e: unknown) => Boolean(e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT"));

/** Reads the fields of the linked Jira project's site again and replaces the cached catalog. Reads Jira only. */
export async function refreshJiraFields(form: FormData): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const project = String(form.get("project") ?? "");
  const { data: link } = await ctx.supabase.from("jira_project_links").select("id, tenant_id, connection_id, site_id, jira_project_key").eq("project_id", project).eq("tenant_id", ctx.active.tenantId).maybeSingle();
  const { data: conn } = link ? await ctx.supabase.from("jira_connections").select("state").eq("id", link.connection_id).maybeSingle() : { data: null };
  let status = "fields-read";
  if (!link || conn?.state !== "connected") status = "link-unavailable";
  else {
    try {
      await refreshFieldCatalog(link, ctx.user.id);
    } catch (e) {
      status = e instanceof ReconnectNeeded ? "read-reconnect" : "fields-failed";
    }
  }
  return back(status, project);
}

/** Maps one Jira field (by id, as read in the cached catalog) to a PV field, or clears the mapping when the choice is empty. */
export async function saveJiraFieldMapping(form: FormData): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const project = String(form.get("project") ?? "");
  const fieldId = String(form.get("field") ?? "");
  const [pv = "", direction = ""] = String(form.get("target") ?? "").split(":");
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(fieldId)) return back("error", project);
  try {
    if (!pv) {
      const { error } = await ctx.supabase.rpc("jira_remove_field_mapping", { p_project: project, p_jira_field_id: fieldId });
      return back(error ? (error.code === "42501" ? "not-admin" : "error") : "map-removed", project);
    }
    // name, kind and custom flag come from the cached catalog (what Jira said), never from the form
    const { data: link } = await ctx.supabase.from("jira_project_links").select("id").eq("project_id", project).eq("tenant_id", ctx.active.tenantId).maybeSingle();
    const { data: cat } = link ? await ctx.supabase.from("jira_field_catalogs").select("fields").eq("link_id", link.id).maybeSingle() : { data: null };
    const field = parseCatalogRows(cat?.fields).find((r) => r.id === fieldId);
    if (!field) return back("map-unknown-field", project);
    const check = validateJiraMapping({ id: field.id, custom: field.custom, kind: field.kind }, pv, direction);
    if (!check.ok) return back(`map-${check.code}`, project);
    const { error } = await ctx.supabase.rpc("jira_set_field_mapping", {
      p_project: project, p_jira_field_id: field.id, p_jira_field_name: field.name.slice(0, 200), p_jira_kind: field.kind satisfies JiraKind, p_jira_custom: field.custom, p_pv_field: pv, p_direction: direction,
    });
    if (error) return back(error.code === "42501" ? "not-admin" : error.code === "PV011" ? `map-${error.hint ?? "refused"}` : error.code === "PV012" ? "map-taken" : "error", project);
    return back("map-saved", project);
  } catch (e) {
    if (isRedirect(e)) throw e;
    return back("error", project);
  }
}
