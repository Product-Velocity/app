import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rememberTenant } from "@/lib/session";

/**
 * The public "See the demo" button (issue #559): signs the visitor's browser into the fixed, shared
 * read-only demo account and lands them straight in Meridian Media, no credentials entered. The account
 * is role "viewer" and is_service_account (packages/db/migrations/20261121084429_demo_viewer_account.sql),
 * so every write is already refused by the normal role rules; the app adds a banner and a few UI-only
 * lockdowns (export, the account page, AI connectors) on top (docs/15-ACCOUNTS-AND-ADMIN.md).
 */
export async function GET(request: NextRequest) {
  const email = process.env.DEMO_VIEWER_EMAIL;
  const password = process.env.DEMO_VIEWER_PASSWORD;
  const tenantId = process.env.DEMO_TENANT_ID;
  if (!email || !password || !tenantId) {
    return NextResponse.redirect(new URL("/?demo=unavailable", request.url), 303);
  }
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return NextResponse.redirect(new URL("/?demo=unavailable", request.url), 303);
  await rememberTenant(tenantId);
  return NextResponse.redirect(new URL("/portfolio", request.url), 303);
}
