"use server";

import { revalidatePath } from "next/cache";
import { derivePalette, normalizeHex } from "@pv/domain";
import { requireWorkspace } from "@/lib/session";
import { hasFeature } from "@/lib/entitlements";
import { supabaseFileStore } from "@/lib/files/store";
import { fetchPublic } from "@/lib/link-title";
import { MAX_LOGO_INPUT, makeLogoPng } from "@/lib/brand/logo";
import { detectBrandFromWebsite } from "@/lib/brand/detect-website";
import { ACCENT_SLOTS, readTheme, MAX_THEME_FILE } from "@/lib/brand/theme-parse";

/** What a detection found. A proposal only: nothing is saved until a person uses it and an admin confirms the brand. */
export type Proposal = { source: "website" | "presentation"; sourceNote: string; name: string | null; colors: string[]; fonts: string[]; logoCandidates: string[]; logoDataUrl: string | null; notes: string[] };
export type BrandState = { error?: string; ok?: string; notes?: string[]; proposal?: Proposal } | null;

const PATH = "/settings/company-profile";
type Ctx = Awaited<ReturnType<typeof requireWorkspace>>;

/** Brand settings are for a human workspace admin on a plan that includes branding; the database refuses everyone else too. */
async function adminCtx(): Promise<{ ok: true; ctx: Ctx } | { ok: false; error: string }> {
  const ctx = await requireWorkspace(PATH);
  if (ctx.active.role !== "admin" || ctx.active.platform) return { ok: false, error: "Only workspace admins can change the brand." };
  if (!(await hasFeature(ctx.supabase, ctx.active.tenantId, "branding"))) return { ok: false, error: "Company branding is not part of this workspace's plan." };
  return { ok: true, ctx };
}
const text = (v: FormDataEntryValue | null, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export async function saveBrand(_prev: BrandState, form: FormData): Promise<BrandState> {
  const a = await adminCtx();
  if (!a.ok) return { error: a.error };
  const { supabase, active } = a.ctx;
  const primaryRaw = text(form.get("primary_color"), 20), accentRaw = text(form.get("accent_color"), 20);
  const primary = primaryRaw ? normalizeHex(primaryRaw) : null, accent = accentRaw ? normalizeHex(accentRaw) : null;
  if (primaryRaw && !primary) return { error: "The main colour must be a hex colour such as #2270ED." };
  if (accentRaw && !accent) return { error: "The accent colour must be a hex colour such as #F59E0B." };
  const name = text(form.get("display_name"), 120), heading = text(form.get("heading_font"), 80), body = text(form.get("body_font"), 80);
  const source = ["typed", "website", "presentation", "claude"].includes(String(form.get("source"))) ? String(form.get("source")) : "typed";
  const values = {
    display_name: name || null, primary_color: primary, accent_color: accent, heading_font: heading || null, body_font: body || null,
    source, source_note: text(form.get("source_note"), 300) || null, detected_at: form.get("detected") === "1" ? new Date().toISOString() : undefined,
    use_on_voting: form.get("use_on_voting") === "on", use_in_app: form.get("use_in_app") === "on",
  };
  const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
  const { data: existing } = await supabase.from("workspace_brand").select("tenant_id").eq("tenant_id", active.tenantId).maybeSingle();
  const { error } = existing
    ? await supabase.from("workspace_brand").update(clean).eq("tenant_id", active.tenantId)
    : await supabase.from("workspace_brand").insert({ tenant_id: active.tenantId, ...clean });
  if (error) return { error: error.code === "PV004" ? "Only a workspace admin can change a confirmed brand." : error.code === "23514" ? "One of the values is not allowed. Check the colours and the lengths." : "We could not save the brand." };
  revalidatePath(PATH);
  const p = primary ? derivePalette(primary, accent ?? undefined) : null;
  return { ok: "Saved as a draft. Confirm it to use it.", notes: p && p.ok ? p.palette.notes : [] };
}

export async function setBrandStatus(_prev: BrandState, form: FormData): Promise<BrandState> {
  const a = await adminCtx();
  if (!a.ok) return { error: a.error };
  const status = form.get("status") === "confirmed" ? "confirmed" : "draft";
  const { data, error } = await a.ctx.supabase.from("workspace_brand").update({ status }).eq("tenant_id", a.ctx.active.tenantId).select("status");
  if (error) return { error: error.code === "22023" ? "Give the brand a main colour before confirming it." : error.code === "PV004" ? "Only a workspace admin can do that." : "We could not change the brand." };
  if (!data?.length) return { error: "Save the brand first." };
  revalidatePath(PATH);
  return { ok: status === "confirmed" ? "Confirmed. It is used where you switched it on." : "Reopened as a draft. It is not used until you confirm it again." };
}

/** Makes the PNG, stores it under this workspace's folder, records it through the database function, and removes the file it replaces. */
async function storeLogo(ctx: Ctx, bytes: Uint8Array): Promise<BrandState> {
  const r = await makeLogoPng(bytes);
  if (!r.ok) return { error: r.error };
  const { supabase, active } = ctx;
  const { data: prev } = await supabase.from("workspace_brand").select("logo_path").eq("tenant_id", active.tenantId).maybeSingle();
  const path = `brand/${active.tenantId}/${r.sha}.png`;
  const store = supabaseFileStore();
  try { await store.put(path, r.png, "image/png"); } catch (e) { if (!/exists|duplicate/i.test(String((e as Error).message))) return { error: "We could not store the logo." }; }
  const { error } = await supabase.rpc("workspace_brand_set_logo", { p_tenant: active.tenantId, p_path: path, p_sha: r.sha, p_width: r.width, p_height: r.height });
  if (error) return { error: error.code === "PV004" ? "Only a workspace admin can change a confirmed brand." : "We could not save the logo." };
  const old = (prev as { logo_path: string | null } | null)?.logo_path;
  if (old && old !== path) await store.remove(old).catch(() => undefined);
  revalidatePath(PATH);
  return { ok: "The logo was saved." };
}

/** A logo from a file picked here, or from a picture a detection found (sent back as base64). */
export async function uploadLogo(_prev: BrandState, form: FormData): Promise<BrandState> {
  const a = await adminCtx();
  if (!a.ok) return { error: a.error };
  const file = form.get("logo");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_LOGO_INPUT) return { error: "The logo must be 1 MB or smaller." };
    return storeLogo(a.ctx, new Uint8Array(await file.arrayBuffer()));
  }
  const b64 = String(form.get("logo_b64") ?? "");
  if (b64 && b64.length <= 1_400_000) return storeLogo(a.ctx, new Uint8Array(Buffer.from(b64.replace(/^data:[^,]*,/, ""), "base64")));
  return { error: "Choose a logo file first." };
}

/** A logo found on the company's website: fetched here under the public-internet rules, then treated like an upload. */
export async function useLogoFromUrl(_prev: BrandState, form: FormData): Promise<BrandState> {
  const a = await adminCtx();
  if (!a.ok) return { error: a.error };
  const got = await fetchPublic(String(form.get("url") ?? "").slice(0, 2000), { accept: "image/*", maxBytes: MAX_LOGO_INPUT, types: /^image\/(png|jpe?g|svg\+xml|webp)/i, timeoutMs: 6000, userAgent: "ProductVelocityBrandReader/1.0" });
  if (!got) return { error: "We could not fetch that image. Download it and upload the file instead." };
  return storeLogo(a.ctx, new Uint8Array(got.body));
}

export async function removeLogo(): Promise<BrandState> {
  const a = await adminCtx();
  if (!a.ok) return { error: a.error };
  const { supabase, active } = a.ctx;
  const { data: prev } = await supabase.from("workspace_brand").select("logo_path").eq("tenant_id", active.tenantId).maybeSingle();
  const { error } = await supabase.rpc("workspace_brand_clear_logo", { p_tenant: active.tenantId });
  if (error) return { error: error.code === "PV004" ? "Only a workspace admin can change a confirmed brand." : "We could not remove the logo." };
  const old = (prev as { logo_path: string | null } | null)?.logo_path;
  if (old) await supabaseFileStore().remove(old).catch(() => undefined);
  revalidatePath(PATH);
  return { ok: "The logo was removed." };
}

/** Reads the company website (the one in Workspace settings unless another is typed) and proposes a brand. Saves nothing. */
export async function detectFromWebsite(_prev: BrandState, form: FormData): Promise<BrandState> {
  const a = await adminCtx();
  if (!a.ok) return { error: a.error };
  const { data: t } = await a.ctx.supabase.from("tenants").select("company_url").eq("id", a.ctx.active.tenantId).maybeSingle();
  const url = text(form.get("url"), 300) || (t as { company_url: string | null } | null)?.company_url || "";
  if (!url) return { error: "Add your company website in Workspace settings, or type it here." };
  const found = await detectBrandFromWebsite(url);
  if (!found) return { error: "We could not read that website. Check the address, or upload the logo and type the colours." };
  return { ok: "Here is what the website says. Use what is right; nothing is saved until you do.", proposal: { source: "website", sourceNote: url.slice(0, 300), name: found.name, colors: found.colors, fonts: found.fonts, logoCandidates: found.logoCandidates, logoDataUrl: null, notes: found.notes } };
}

/** Reads the theme of a shared PowerPoint or Word file (colours, fonts and, for a presentation, the logo on its master) and proposes a brand. Saves nothing. */
export async function detectFromFile(_prev: BrandState, form: FormData): Promise<BrandState> {
  const a = await adminCtx();
  if (!a.ok) return { error: a.error };
  const file = form.get("theme");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a PowerPoint or Word file first." };
  if (file.size > MAX_THEME_FILE) return { error: "The file must be 25 MB or smaller." };
  const r = await readTheme(new Uint8Array(await file.arrayBuffer()), file.name);
  if (!r.ok) return { error: r.error };
  const t = r.theme;
  const colors = [...new Set([...ACCENT_SLOTS.map((s) => t.colors[s]), t.colors.dk2].filter((c): c is string => !!c))];
  let logoDataUrl: string | null = null;
  if (t.logo) { const l = await makeLogoPng(t.logo); if (l.ok) logoDataUrl = `data:image/png;base64,${l.png.toString("base64")}`; }
  return { ok: "Here is what the file's theme says. Use what is right; nothing is saved until you do.", proposal: { source: "presentation", sourceNote: file.name.slice(0, 300), name: t.name, colors, fonts: [t.fonts.major, t.fonts.minor].filter((f): f is string => !!f), logoCandidates: [], logoDataUrl, notes: colors.length === 0 ? ["The theme defines no colours."] : [] } };
}
