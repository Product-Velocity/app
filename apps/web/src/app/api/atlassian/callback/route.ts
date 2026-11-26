import { NextResponse, type NextRequest } from "next/server";
import { completeConnection } from "@/lib/atlassian/connect";
import { verifyConnectState } from "@/lib/atlassian/connect-state";
import { keyRing } from "@/lib/atlassian/token-crypto";
import { completeConfluenceConnection } from "@/lib/confluence/connect";

/**
 * Return point of the Atlassian sign-in (issue #67). Only a state signed by startJiraConnection ("pv1.…", bound to one admin, one workspace
 * and expiring) is accepted; completeConnection checks it again against the signed-in person. Anything else goes back to the Jira settings
 * page. (The throwaway J1 spike that used to live here was removed in the 2026-11-23 security review.)
 */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const state = new URL(request.url).searchParams.get("state");
  // one return address for both sign-ins; the signed state says which connection it is for (Confluence has its own, issue #693)
  const ring = keyRing();
  const parsed = ring && state?.startsWith("pv1.") ? verifyConnectState(state, ring.current) : null;
  const page = parsed?.k === "confluence"
    ? await completeConfluenceConnection(request, parsed)
    : state?.startsWith("pv1.") ? await completeConnection(request, state) : "/settings/integrations/jira?status=bad-link";
  return NextResponse.redirect(new URL(page, request.url));
}
