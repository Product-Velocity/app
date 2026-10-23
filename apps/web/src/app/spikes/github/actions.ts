"use server";
// THROWAWAY spike actions for issue #30. Admin-only; every call is limited to the sandbox by isSandboxPath.
import { requireWorkspace } from "@/lib/session";
import { gh, SANDBOX_ORG, SANDBOX_REPO, type CallResult } from "@/lib/spikes/github-app";
import { runCheckById } from "@/lib/spikes/checks";
import type { CheckResult } from "@/lib/spikes/checks-shared";

export type SpikeOutput = { title: string; steps: { label: string; result: CallResult | { error: string } }[] };

async function guard() {
  const { active } = await requireWorkspace("/spikes/github");
  if (active.role !== "admin") throw new Error("Admins only");
}

export async function runCheck(id: string): Promise<CheckResult> {
  await guard();
  return runCheckById(id);
}

/** Free-form probe for anything the suite does not cover; the path is still limited to the sandbox. */
export async function probe(_prev: SpikeOutput | null, form: FormData): Promise<SpikeOutput> {
  await guard();
  const method = String(form.get("method") ?? "GET").toUpperCase();
  if (!["GET", "POST", "PATCH", "PUT"].includes(method)) throw new Error("Method not allowed");
  const path = String(form.get("path") ?? "").trim();
  const raw = String(form.get("body") ?? "").trim();
  const body: unknown = raw ? JSON.parse(raw) : undefined;
  const auth = form.get("auth") === "app" ? "app" : "installation";
  let result: CallResult | { error: string };
  try {
    result = await gh(auth, method, path, body);
  } catch (e) {
    result = { error: e instanceof Error ? e.message : String(e) };
  }
  return { title: `Probe ${method} ${path} (${SANDBOX_ORG}/${SANDBOX_REPO})`, steps: [{ label: `${auth} token`, result }] };
}
