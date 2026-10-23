import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const pkg = JSON.parse(readFileSync(path.join(root, "apps/web/package.json"), "utf8")) as { version: string };
const log = readFileSync(path.join(root, "docs/RELEASES.md"), "utf8");

describe("app version", () => {
  it("is a 0.MINOR.PATCH version", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("matches the newest row of docs/RELEASES.md, so a release is never made without a log entry", () => {
    const newest = /^\| (\d+\.\d+\.\d+) \|/m.exec(log)?.[1];
    expect(newest).toBe(pkg.version);
  });
  it("lists every version once, newest first", () => {
    const versions = [...log.matchAll(/^\| (\d+\.\d+\.\d+) \|/gm)].map((m) => m[1]!);
    expect(new Set(versions).size).toBe(versions.length);
    const key = (v: string) => v.split(".").map(Number).reduce((a, n) => a * 1000 + n, 0);
    expect(versions).toEqual([...versions].sort((a, b) => key(b) - key(a)));
  });
});
