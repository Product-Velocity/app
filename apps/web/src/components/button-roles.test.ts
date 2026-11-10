import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Brand rule: a button that deletes, removes, revokes or disconnects is red (btn-danger or btn-danger-quiet). Plain inline links are the one exception. */
const root = join(__dirname, "..");
const files: string[] = [];
(function walk(dir: string) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== "node_modules" && e !== "dev" && e !== "spikes") walk(p); } else if (p.endsWith(".tsx")) files.push(p);
  }
})(root);

const BUTTON = /<button\b([^>]*)>\s*(Delete|Remove|Revoke|Disconnect|Discard)\b/g;
const LINK_LIKE = /link-button|bulk-link|chip-x/;

describe("destructive buttons are red", () => {
  it("every Delete, Remove, Revoke, Disconnect or Discard button uses a danger style", () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(BUTTON)) {
        const attrs = m[1] ?? "";
        if (!/danger/.test(attrs) && !LINK_LIKE.test(attrs)) bad.push(`${f.slice(root.length + 1)}: ${m[2]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
