import { loadPublicLogo } from "@/lib/brand/public-logo";

export const dynamic = "force-dynamic";

/** The logo of a confirmed company brand, for the voting screens and the voter emails (voters have no account). See lib/brand/public-logo.ts. */
export async function GET(_request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const logo = await loadPublicLogo(token);
  if (!logo) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(Buffer.from(logo.bytes), {
    headers: {
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Cache-Control": "public, max-age=3600",
      ETag: `"${logo.sha}"`,
    },
  });
}
