import { EVENT_STATUS, verifySvix } from "@/lib/email/svix";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Resend delivery events (delivered, bounced, complained) for invitation emails. Verifies the signature first; reads only the event
 * name and Resend's message id; writes the delivery state of the matching invitation. Logs event names, never addresses or bodies.
 */
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return new Response("not configured", { status: 503 });
  const raw = await request.text();
  const ok = verifySvix(raw, { id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature") }, secret);
  if (!ok) return new Response("bad signature", { status: 401 });
  let event: { type?: unknown; data?: { email_id?: unknown } };
  try { event = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  const status = typeof event.type === "string" ? EVENT_STATUS[event.type] : undefined;
  const id = event.data?.email_id;
  if (!status || typeof id !== "string") return new Response("ignored");
  const admin = createAdminClient({ via: "system" });
  // a delivered message never overrides a bounce that arrived first
  const query = admin.from("invitations").update({ email_status: status }).eq("email_provider_id", id);
  const { error } = await (status === "delivered" ? query.eq("email_status", "sent") : query);
  if (error) { console.error(JSON.stringify({ resend: "webhook", event: event.type, error: error.message.slice(0, 160) })); return new Response("error", { status: 500 }); }
  return new Response("ok");
}
