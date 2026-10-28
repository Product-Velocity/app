"use server";

import { redirect } from "next/navigation";
import { requirePlatformAdmin, rememberTenant, requireUser } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEVELS = ["read_write", "read_only"] as const;
type Level = (typeof LEVELS)[number];
const level = (v: FormDataEntryValue | null): Level | null => (LEVELS as readonly string[]).includes(String(v)) ? (v as Level) : null;
const done = (path: string, code: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}notice=${code}`);

/** Enter a customer account (R-111 FR-2.1). The database checks the caller is a platform admin and, for write access, a recent sign-in. */
export async function enterAccount(form: FormData): Promise<void> {
  const tenant = String(form.get("tenant") ?? "");
  const reason = String(form.get("reason") ?? "").trim().slice(0, 500);
  const { supabase } = await requirePlatformAdmin("/platform");
  if (!UUID.test(tenant)) done("/platform", "bad-account");
  const { error } = await supabase.rpc("platform_enter_account", { p_tenant: tenant, p_reason: reason || null });
  if (error) done("/platform", error.code === "PV020" ? "reauth" : "enter-failed");
  await rememberTenant(tenant);
  redirect(`/w/${tenant}/portfolio`);
}

/** Leave the customer account the admin is in. Logged in that account's audit log. */
export async function leavePlatformAccount(): Promise<void> {
  const { supabase } = await requireUser("/platform");
  await supabase.rpc("platform_leave_account");
  redirect("/platform?notice=left");
}

export async function setDefaultLevel(form: FormData): Promise<void> {
  const l = level(form.get("level"));
  const { supabase } = await requirePlatformAdmin("/platform/settings");
  if (!l) done("/platform/settings", "bad-level");
  const { error } = await supabase.rpc("platform_set_default_level", { p_level: l });
  done("/platform/settings", error ? "failed" : "default-saved");
}

export async function setAdminLevel(form: FormData): Promise<void> {
  const user = String(form.get("user") ?? "");
  const raw = String(form.get("level") ?? "");
  const l = raw === "default" ? null : level(raw);
  const { supabase } = await requirePlatformAdmin("/platform/settings");
  if (!UUID.test(user) || (raw !== "default" && !l)) done("/platform/settings", "bad-level");
  const { error } = await supabase.rpc("platform_set_admin_level", { p_user: user, p_level: l });
  done("/platform/settings", error ? "failed" : "admin-saved");
}

export async function setAccountLevel(form: FormData): Promise<void> {
  const tenant = String(form.get("tenant") ?? "");
  const restrict = form.get("level") === "read_only";
  const { supabase } = await requirePlatformAdmin("/platform");
  if (!UUID.test(tenant)) done("/platform", "bad-account");
  const { error } = await supabase.rpc("platform_set_account_level", { p_tenant: tenant, p_level: restrict ? "read_only" : null });
  done("/platform", error ? "failed" : restrict ? "account-restricted" : "account-unrestricted");
}

export async function setPlatformAdmin(form: FormData): Promise<void> {
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 254);
  const active = form.get("active") === "true";
  const { supabase } = await requirePlatformAdmin("/platform/settings");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) done("/platform/settings", "bad-email");
  const { error } = await supabase.rpc("platform_set_admin", { p_email: email, p_active: active });
  if (error) done("/platform/settings", error.code === "PV023" ? "self" : error.code === "P0002" ? "no-such-user" : "failed");
  done("/platform/settings", active ? "admin-added" : "admin-removed");
}

export async function setPlan(form: FormData): Promise<void> {
  const tenant = String(form.get("tenant") ?? "");
  const plan = String(form.get("plan") ?? "").trim();
  const { supabase } = await requirePlatformAdmin("/platform");
  if (!UUID.test(tenant) || plan.length < 1 || plan.length > 40) done("/platform", "bad-plan");
  const { error } = await supabase.rpc("platform_set_plan", { p_tenant: tenant, p_plan: plan });
  done("/platform", error ? "failed" : "plan-saved");
}

/** Deletes an account for good. The database refuses unless the exact account name is typed; the deletion is recorded in the configuration log. */
export async function deleteAccount(form: FormData): Promise<void> {
  const tenant = String(form.get("tenant") ?? "");
  const name = String(form.get("confirm_name") ?? "");
  const { supabase } = await requirePlatformAdmin("/platform");
  if (!UUID.test(tenant)) done("/platform", "bad-account");
  const { error } = await supabase.rpc("platform_delete_account", { p_tenant: tenant, p_confirm_name: name });
  done("/platform", error ? (error.code === "PV024" ? "delete-name" : "failed") : "deleted");
}
