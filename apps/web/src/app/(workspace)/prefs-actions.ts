"use server";

import { requireWorkspace } from "@/lib/session";
import { clampPanelWidth, sanitizeLocation, withLastLocation } from "@/lib/user-prefs";

/** Remembers how wide the person wants the item panel. Stored in their own profile; touches no workspace data. */
export async function savePanelWidth(width: number): Promise<void> {
  const { supabase } = await requireWorkspace("/portfolio");
  if (typeof width !== "number") return;
  await supabase.auth.updateUser({ data: { panel_width: clampPanelWidth(width) } });
}

/** Remembers the screen and view the person was on in this account, so signing in again lands there. The account comes from the address, never from the caller. */
export async function saveLastLocation(path: string): Promise<void> {
  const { supabase, user, active } = await requireWorkspace("/portfolio");
  const clean = sanitizeLocation(path);
  if (!clean) return;
  await supabase.auth.updateUser({ data: { last_location: withLastLocation(user.user_metadata, active.tenantId, clean) } });
}
