import { handleDelivery } from "@/lib/atlassian/jira-webhooks-server";

/**
 * Receiver for Jira webhooks (spike J3, automated status updates). The last path segment is `<link id>.<secret>`; Jira is given the whole
 * address when the webhook is registered. The body is only a hint (the issue key): the issue is read again from Jira before anything is applied.
 * Always answers fast; Jira retries a 5xx. Not logged: bodies, keys, addresses.
 */
export const maxDuration = 30;

export async function POST(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const text = await request.text();
  if (text.length > 1_000_000) return new Response("too large", { status: 413 });
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { /* not JSON: handled as no key */ }
  const status = await handleDelivery(token, body);
  return new Response(status === 200 ? "ok" : status === 404 ? "not found" : "retry", { status });
}
