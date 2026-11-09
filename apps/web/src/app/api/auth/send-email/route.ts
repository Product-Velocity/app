import { planAuthEmail, verifyHookSignature } from "@/lib/email/auth-hook";
import { sendLogged } from "@/lib/email/send";

/**
 * Supabase "Send Email" hook (issue #370). Verifies the signature before reading the body (401, nothing sent otherwise), renders the
 * auth email from the template registry and sends it through Resend. Answers with the same shape whatever the address, never logs
 * addresses, tokens or bodies. Off (503) until SEND_EMAIL_HOOK_SECRET and SITE_URL are set.
 */
export async function POST(request: Request) {
  const secret = process.env.SEND_EMAIL_HOOK_SECRET;
  const appUrl = process.env.SITE_URL;
  if (!secret || !appUrl) return new Response("not configured", { status: 503 });
  const raw = await request.text();
  const ok = verifyHookSignature(raw, { id: request.headers.get("webhook-id"), timestamp: request.headers.get("webhook-timestamp"), signature: request.headers.get("webhook-signature") }, secret);
  if (!ok) return new Response("bad signature", { status: 401 });
  let payload;
  try { payload = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  const plan = planAuthEmail(payload, appUrl);
  if (!plan.ok) {
    console.error(JSON.stringify({ authEmail: plan.reason }));
    return Response.json({ error: { http_code: 422, message: "This email type is not handled." } }, { status: 422 });
  }
  for (const m of plan.mails) {
    const sent = await sendLogged(m.key, { to: m.to, ...m.mail });
    if (!sent.ok) {
      console.error(JSON.stringify({ authEmail: "send-failed", error: sent.error }));
      return Response.json({ error: { http_code: 500, message: "The email could not be sent." } }, { status: 500 });
    }
  }
  return Response.json({});
}
