import { headers } from "next/headers";

/** Public origin of this deployment, used for auth redirects and invite links. */
export async function siteUrl(): Promise<string> {
  const fixed = process.env.SITE_URL;
  if (fixed) return fixed.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
