// THROWAWAY spike route for issue #30 (S5b, S2b). Verifies GitHub's signature and logs only event metadata.
// Payloads are not stored: read them from the App's "Advanced > Recent Deliveries" page on GitHub.
import { verifySignature } from "@/lib/spikes/github-app";

export async function POST(request: Request) {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  if (!secret) return new Response("not configured", { status: 503 });
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
    return new Response("bad signature", { status: 401 });
  }
  let action: unknown;
  try {
    action = (JSON.parse(raw) as { action?: unknown }).action;
  } catch {}
  console.log(
    JSON.stringify({
      spike: "github-webhook",
      event: request.headers.get("x-github-event"),
      action,
      delivery: request.headers.get("x-github-delivery"),
    }),
  );
  return new Response("ok");
}
