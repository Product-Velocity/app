import { parseConnectionEvent, verifySignature } from "@pv/github";
import { applyConnectionEvent, githubSecret, githubSourceControl } from "@/lib/github/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GitHub App webhook. Verifies the signature, then handles installation events (the only thing that makes a
 * connection "connected"). Every other event is acknowledged and ignored until the sync slices (#32). Logs event
 * names only, never payloads, tokens or document contents.
 */
export async function POST(request: Request) {
  const secret = githubSecret();
  if (!secret) return new Response("not configured", { status: 503 });
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), secret)) return new Response("bad signature", { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const event = request.headers.get("x-github-event");
  const parsed = parseConnectionEvent(event, payload);
  if (!parsed) return new Response("ignored");

  const sc = githubSourceControl();
  if (!sc) return new Response("not configured", { status: 503 });
  try {
    await applyConnectionEvent(createAdminClient({ via: "GitHub webhook" }), sc, parsed);
  } catch (e) {
    console.error(JSON.stringify({ github: "webhook", event, action: parsed.action, delivery: request.headers.get("x-github-delivery"), error: e instanceof Error ? e.message : "unknown" }));
    return new Response("error", { status: 500 });
  }
  return new Response("ok");
}
