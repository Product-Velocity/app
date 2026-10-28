import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Issue #238: requests and decisions are one file each, so two agents never edit the same line. This keeps the files well formed.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const files = (dir: string) => readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md").sort();
const header = (dir: string, f: string) => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(path.join(root, dir, f), "utf8"));
  if (!m) return null;
  return Object.fromEntries(m[1]!.split("\n").map((l) => /^([a-z_]+):\s*(.*)$/.exec(l)).filter(Boolean).map((x) => [x![1]!, x![2]!.trim()]));
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

describe("docs/requests", () => {
  const list = files("docs/requests");
  it("every file starts with its GitHub issue number, and the numbers are unique", () => {
    const ids = list.map((f) => f.split("-")[0]);
    for (const f of list) expect(f, f).toMatch(/^\d+-[a-z0-9][a-z0-9-]*\.md$/);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("every header names that issue, a known status and the date it was logged", () => {
    for (const f of list) {
      const h = header("docs/requests", f);
      expect(h, `${f} has no header`).not.toBeNull();
      expect(h!.issue, f).toBe(f.split("-")[0]);
      expect(["open", "in progress", "done", "blocked"], f).toContain(h!.status);
      expect(h!.logged, f).toMatch(DATE);
      expect(h!.title, f).toBeTruthy();
      if (h!.status === "done") expect(h!.done, `${f}: say when it was done`).toMatch(DATE);
    }
  });
});

describe("docs/decisions", () => {
  const list = files("docs/decisions");
  it("every file is dated in its name and header and says who decided", () => {
    for (const f of list) {
      expect(f, f).toMatch(/^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$/);
      const h = header("docs/decisions", f);
      expect(h, `${f} has no header`).not.toBeNull();
      expect(h!.date, f).toBe(f.slice(0, 10));
      expect(h!.by, f).toBeTruthy();
    }
  });
});
