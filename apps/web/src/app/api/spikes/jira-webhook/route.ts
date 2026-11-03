// THROWAWAY receiver for spike J3 (#257). Logs only the event name, the header NAMES and the body size: never a body, URL, id or text.
// Remove with the spike page. Always answers 200 so Jira does not retry.
export async function POST(request: Request) {
  const text = await request.text();
  let event = "unknown";
  try { event = String((JSON.parse(text) as { webhookEvent?: unknown }).webhookEvent ?? "unknown").slice(0, 60); } catch { /* not JSON */ }
  const names = [...request.headers.keys()].filter((k) => /sign|hub|atlassian|retry|webhook|x-/i.test(k)).sort().join(",");
  console.log(JSON.stringify({ jiraWebhookSpike: event, bytes: text.length, headers: names, at: new Date().toISOString() }));
  return new Response("ok");
}
