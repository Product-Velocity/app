import { createAdminClient } from "@/lib/supabase/admin";
import { PIXEL_GIF, isUuid } from "@/lib/email/open-pixel";

/**
 * The open-tracking image (issue #634). Public on purpose: a mail program fetches it with no sign-in. It records that the email with this id
 * was opened (a count and the first time, in the send log) and answers with a transparent GIF whatever happens. It never reads or stores
 * the visitor's address, browser or place, and never logs anything. An id that is not a UUID is ignored without touching the database.
 */
const HEADERS = {
  "Content-Type": "image/gif",
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (isUuid(id)) {
    try {
      await createAdminClient({ via: "system" }).rpc("record_email_open", { p_id: id });
    } catch {
      // the image is served either way
    }
  }
  return new Response(new Uint8Array(PIXEL_GIF), { status: 200, headers: HEADERS });
}
