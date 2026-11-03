import { withBackoff, type JiraRequest, type Sleep } from "./jira-write";

// Jira reads with back-off (spike J6, #257). Pure over an injected `call`, so it is tested with a fake Jira. A 429 or 503 is retried with the
// Retry-After the site sent (capped, see withBackoff); every other refusal throws "Jira answered <status>" exactly as before, so callers that
// look for 400 (refresh of linked issues) keep working. ReconnectNeeded from the token provider propagates.
export async function getJson<T>(call: JiraRequest, path: string, sleep?: Sleep): Promise<T> {
  const r = await withBackoff(() => call("GET", path), sleep);
  if (r.status < 200 || r.status >= 300) throw new Error(`Jira answered ${r.status}`);
  return r.json as T;
}
