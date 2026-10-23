import { EVENTS_LATER, PERMISSIONS_LATER, PERMISSIONS_NOW, permissionGaps } from "./permissions";
import type { SourceControl } from "./source-control";

export type Verdict = "pass" | "fail" | "info";
export type CheckResult = { id: string; title: string; verdict: Verdict; summary: string; fix?: string };

export type DiagnosticsInput = {
  sc: SourceControl;
  installationId: number;
  expectedAccount: string;
  /** Default repository of each project that has one, as "owner/name". */
  projectRepos: { project: string; repo: string }[];
};

const safe = async <T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> => {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

/**
 * Read-only checklist for a workspace's own GitHub connection (R-025). It never writes to GitHub and never returns
 * tokens, keys or issue contents. A later slice adds the write round trip on a test item the app owns.
 */
export async function runConnectionDiagnostics(i: DiagnosticsInput): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const add = (r: CheckResult) => out.push(r);

  const inst = await safe(() => i.sc.getInstallation(i.installationId));
  if (!inst.ok || !inst.value) {
    add({
      id: "installation",
      title: "Installation reachable",
      verdict: "fail",
      summary: inst.ok ? "GitHub does not know this installation." : `GitHub could not be reached: ${inst.error}`,
      fix: inst.ok
        ? "The App may have been uninstalled. Disconnect here and connect again."
        : "Check that GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_B64 are set for this deployment, then try again.",
    });
    return out;
  }
  const installation = inst.value;
  add({ id: "installation", title: "Installation reachable", verdict: "pass", summary: `Installed on ${installation.accountLogin} (${installation.accountType}).` });

  add(
    installation.accountLogin.toLowerCase() === i.expectedAccount.toLowerCase()
      ? { id: "account", title: "Installed on the expected account", verdict: "pass", summary: `${installation.accountLogin} matches what the admin entered.` }
      : { id: "account", title: "Installed on the expected account", verdict: "fail", summary: `Expected ${i.expectedAccount} but the installation is on ${installation.accountLogin}.`, fix: "Disconnect and connect again, entering the right organisation." },
  );

  add(
    installation.suspended
      ? { id: "suspended", title: "Installation active", verdict: "fail", summary: "The installation is suspended on GitHub.", fix: "An owner can unsuspend it under Settings > Installed GitHub Apps." }
      : { id: "suspended", title: "Installation active", verdict: "pass", summary: "Not suspended." },
  );

  const gaps = permissionGaps(installation.permissions, PERMISSIONS_NOW);
  add(
    gaps.length
      ? { id: "permissions", title: "Permissions needed now", verdict: "fail", summary: `Missing: ${gaps.join("; ")}.`, fix: "Add the permission in the App's settings, then an organisation owner accepts the change on the installation page." }
      : { id: "permissions", title: "Permissions needed now", verdict: "pass", summary: "Issues (write) and Metadata (read) are granted." },
  );
  const later = permissionGaps(installation.permissions, PERMISSIONS_LATER);
  add({
    id: "permissions-later",
    title: "Permissions for later features",
    verdict: "info",
    summary: later.length ? `Not granted yet (needed for later features, not for connecting): ${later.join("; ")}.` : "All later permissions are granted.",
  });
  const missingEvents = EVENTS_LATER.filter((e) => !installation.events.includes(e));
  add({
    id: "events",
    title: "Webhook events for later features",
    verdict: "info",
    summary: missingEvents.length ? `Not subscribed yet: ${missingEvents.join(", ")}.` : "All events subscribed.",
  });

  const repos = await safe(() => i.sc.listRepositories(i.installationId));
  if (!repos.ok) {
    add({ id: "repositories", title: "Repository access", verdict: "fail", summary: `Could not list repositories: ${repos.error}`, fix: "Check the installation permissions and try again." });
  } else {
    add({
      id: "repositories",
      title: "Repository access",
      verdict: repos.value.length ? "pass" : "fail",
      summary: repos.value.length
        ? `${repos.value.length} repositor${repos.value.length === 1 ? "y" : "ies"} reachable (${installation.repositorySelection === "all" ? "all repositories of the account" : "selected repositories"}).`
        : "The installation reaches no repositories.",
      fix: repos.value.length ? undefined : "On GitHub, open the installation and give the App access to at least one repository.",
    });
    const names = new Set(repos.value.map((r) => r.fullName.toLowerCase()));
    const lost = i.projectRepos.filter((p) => !names.has(p.repo.toLowerCase()));
    add(
      lost.length
        ? { id: "project-repos", title: "Project default repositories", verdict: "fail", summary: `Not reachable any more: ${lost.map((l) => `${l.project} → ${l.repo}`).join("; ")}.`, fix: "Choose another default repository for those projects, or give the App access to the repository again." }
        : { id: "project-repos", title: "Project default repositories", verdict: "pass", summary: i.projectRepos.length ? "Every default repository is reachable." : "No project has a default repository yet." },
    );
  }

  const types = await safe(() => i.sc.listIssueTypes(i.installationId, installation.accountLogin));
  add(
    !types.ok
      ? { id: "issue-types", title: "Issue type Epic", verdict: "info", summary: `Could not read issue types: ${types.error}` }
      : types.value === null
        ? { id: "issue-types", title: "Issue type Epic", verdict: "info", summary: "The App may not read issue types yet (permission Issue types: read). Epics will use a label." }
        : { id: "issue-types", title: "Issue type Epic", verdict: "info", summary: types.value.some((t) => t.toLowerCase() === "epic") ? "Epic exists as an issue type." : `No Epic type (types: ${types.value.join(", ") || "none"}). Epics will use a label.` },
  );

  const deliveries = await safe(() => i.sc.listRecentDeliveries());
  if (!deliveries.ok) {
    add({ id: "webhooks", title: "Webhooks reaching us", verdict: "info", summary: `Could not read deliveries: ${deliveries.error}` });
  } else {
    const recent = deliveries.value.slice(0, 20);
    const bad = recent.filter((d) => d.statusCode >= 400).length;
    add(
      recent.length === 0
        ? { id: "webhooks", title: "Webhooks reaching us", verdict: "fail", summary: "GitHub has not delivered any webhook yet.", fix: "In the App's settings tick Webhook > Active and set the Webhook URL to this app's /api/github/webhook address." }
        : bad
          ? { id: "webhooks", title: "Webhooks reaching us", verdict: "fail", summary: `${bad} of the latest ${recent.length} deliveries were rejected.`, fix: "401 means the webhook secret differs from GITHUB_APP_WEBHOOK_SECRET; 404 means the URL is wrong; 5xx means the receiver crashed." }
          : { id: "webhooks", title: "Webhooks reaching us", verdict: "pass", summary: `The latest ${recent.length} deliveries were accepted.` },
    );
  }
  return out;
}

export function reportMarkdown(title: string, results: CheckResult[]): string {
  const lines = [`# ${title}`, ""];
  for (const r of results) {
    lines.push(`## ${r.verdict.toUpperCase()}: ${r.title}`, r.summary);
    if (r.fix) lines.push("", `Fix: ${r.fix}`);
    lines.push("");
  }
  return lines.join("\n");
}
