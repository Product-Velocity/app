import { describe, expect, it } from "vitest";
import { historyPath, recordStatusHistory, statusChangesOf, type HistoryIssue, type StatusChangeRow } from "./jira-status-history";
import { ReconnectNeeded } from "./token-provider";

const h = (created: string, from: string, to: string, who: string | null, field = "status") => ({ created, author: who === null ? null : { displayName: who }, items: [{ field, fromString: from, toString: to }] });
const issue = (key: string, histories: ReturnType<typeof h>[]): HistoryIssue => ({ key, changelog: { histories } });

describe("statusChangesOf", () => {
  it("lists the moves to a status, oldest first, with Jira's own time and the name of the Jira user", () => {
    const r = statusChangesOf(issue("R8P-4299", [
      h("2026-11-17T09:18:23.641+0100", "Project Execution", "Project Accepted", "Dana Reyes"),
      h("2026-11-13T13:18:05.034+0100", "Project Execution", "Project Closed", "Sam Okoye"),
      h("2026-11-17T09:18:10.065+0100", "Project Closed", "Project Execution", "Dana Reyes"),
    ]));
    expect(r.map((x) => [x.changed_at, x.from_status, x.to_status, x.actor_name])).toEqual([
      ["2026-11-13T12:18:05.034Z", "Project Execution", "Project Closed", "Sam Okoye"],
      ["2026-11-17T08:18:10.065Z", "Project Closed", "Project Execution", "Dana Reyes"],
      ["2026-11-17T08:18:23.641Z", "Project Execution", "Project Accepted", "Dana Reyes"],
    ]);
  });

  it("ignores other fields, a history without a time, a move without a target status and a key that is not a Jira key", () => {
    expect(statusChangesOf(issue("AB-1", [h("2026-11-17T08:00:00Z", "x", "y", "Ana", "assignee"), h("nope", "x", "y", "Ana"), { created: "2026-11-17T08:00:00Z", items: [{ field: "status", fromString: "x" }] } as never]))).toEqual([]);
    expect(statusChangesOf(issue("not a key", [h("2026-11-17T08:00:00Z", "x", "y", "Ana")]))).toEqual([]);
    expect(statusChangesOf({ key: "AB-1" })).toEqual([]);
  });

  it("keeps no name when Jira gives none (an automation, a hidden profile), cuts a long name, and strips control characters; text is data", () => {
    const r = statusChangesOf(issue("AB-1", [h("2026-11-17T08:00:00Z", "a", "b", null), h("2026-11-17T08:01:00Z", "b", "c", `${"x".repeat(200)}`), h("2026-11-17T08:02:00Z", "c", "d", "Ana\u0000\n<script>alert(1)</script>")]));
    expect(r[0]!.actor_name).toBeNull();
    expect(r[1]!.actor_name).toHaveLength(120);
    expect(r[2]!.actor_name).toBe("Ana <script>alert(1)</script>"); // stored as text; the screen shows it as text
  });

  it("never stores an email or an account id: only the display name is read", () => {
    const rows = statusChangesOf({ key: "AB-1", changelog: { histories: [{ created: "2026-11-17T08:00:00Z", author: { displayName: "Ana", emailAddress: "ana@example.test", accountId: "abc123" } as never, items: [{ field: "status", fromString: "a", toString: "b" }] }] } });
    expect(JSON.stringify(rows)).not.toMatch(/example\.test|abc123|accountId|email/i);
  });
});

describe("recordStatusHistory", () => {
  const fake = (issues: HistoryIssue[], fail?: Error) => {
    const saved: StatusChangeRow[] = [], asked: string[] = [];
    return { saved, asked, deps: { async getPage(path: string) { asked.push(path); if (fail) throw fail; return { issues } as never; }, async save(rows: StatusChangeRow[]) { saved.push(...rows); } } };
  };

  it("reads the history of the keys asked for and stores every status change, also the old ones", async () => {
    const f = fake([issue("AB-1", [h("2026-11-01T08:00:00Z", "a", "b", "Ana"), h("2026-11-02T08:00:00Z", "b", "c", "Ben")]), issue("ZZ-9", [h("2026-11-02T08:00:00Z", "a", "b", "Eve")])]);
    const r = await recordStatusHistory(f.deps, ["AB-1", "not a key"]);
    expect(r).toEqual({ issues: 1, changes: 2, error: null }); // Z-9 was not asked for: ignored
    expect(f.saved.map((x) => x.actor_name)).toEqual(["Ana", "Ben"]);
    expect(decodeURIComponent(f.asked[0]!).replace(/\+/g, " ")).toContain('key in ("AB-1")');
    expect(f.asked[0]).toContain("expand=changelog");
  });

  it("works in batches of 100 keys", async () => {
    const f = fake([]);
    await recordStatusHistory(f.deps, Array.from({ length: 230 }, (_, i) => `AB-${i + 1}`));
    expect(f.asked).toHaveLength(3);
  });

  it("a failure is reported and never thrown, so it cannot fail the status refresh; a connection that needs a new sign-in does throw", async () => {
    expect((await recordStatusHistory(fake([], new Error("Jira answered 500")).deps, ["AB-1"])).error).toMatch(/500/);
    await expect(recordStatusHistory(fake([], new ReconnectNeeded()).deps, ["AB-1"])).rejects.toBeInstanceOf(ReconnectNeeded);
  });

  it("only valid keys can shape the query", () => {
    expect(() => historyPath(['AB-1") OR project = X OR key in ("B-2'])).toThrow();
    expect(() => historyPath([])).toThrow();
  });
});
