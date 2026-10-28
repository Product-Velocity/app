// Release assembly (issue #238). Feature PRs no longer bump `version` or edit docs/RELEASES.md, because two PRs doing that at once
// always collide. A PR adds a fragment in docs/releases/unreleased/; when it is merged into main this script gives each fragment the
// next version, writes its row at the top of docs/RELEASES.md, bumps apps/web/package.json and removes the fragment.
//
//   node tools/release/assemble.mjs [--pr "#237"] [--date 2026-10-28]
//
// A fragment is Markdown with a small header:
//   ---
//   bump: minor        (minor for a feature, patch for a fix)
//   ---
//   **Title.** What changed, for the person who uses the product (this text becomes the "Key updates" cell).
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const FRAGMENT_DIR = path.join(root, "docs/releases/unreleased");
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/** Reads one fragment: its bump and the text of its row. Throws with a sentence naming the file when it is not valid. */
export function parseFragment(name, text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.replace(/^﻿/, ""));
  if (!m) throw new Error(`${name}: start with a header (--- bump: minor ---) and then the text`);
  const head = Object.fromEntries(
    m[1].split(/\r?\n/).map((l) => /^\s*([a-z_]+)\s*:\s*(.*?)\s*$/i.exec(l)).filter(Boolean).map((x) => [x[1].toLowerCase(), x[2]]),
  );
  if (head.bump !== "minor" && head.bump !== "patch") throw new Error(`${name}: bump must be minor or patch`);
  const plain = m[2].replace(/\s+/g, " ").trim();
  if (plain.length < 20) throw new Error(`${name}: write what changed (a title in bold and a sentence or two)`);
  if (/^\|?\s*\d+\.\d+\.\d+\s*\|/.test(plain)) throw new Error(`${name}: write only the text; the version and date are added for you`);
  return { name, bump: head.bump, body: plain.replace(/\|/g, "\\|") };
}

export function nextVersion(version, bump) {
  const m = VERSION.exec(version);
  if (!m) throw new Error(`not a version: ${version}`);
  const [maj, min, pat] = m.slice(1).map(Number);
  return bump === "minor" ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
}

/**
 * Pure: gives every fragment the next version in file-name order and returns the new RELEASES.md text and the final version.
 * `pr` is written in the PRs column ("" when unknown).
 */
export function assemble({ version, releases, fragments, date, pr = "" }) {
  const lines = releases.split("\n");
  const sep = lines.findIndex((l) => /^\|\s*-{3,}\s*\|/.test(l));
  if (sep < 0) throw new Error("docs/RELEASES.md has no table to add rows to");
  const rows = [];
  let v = version;
  const applied = [];
  for (const f of [...fragments].sort((a, b) => a.name.localeCompare(b.name))) {
    v = nextVersion(v, f.bump);
    rows.unshift(`| ${v} | ${date} | ${f.body} | ${pr} |`);
    applied.push({ version: v, name: f.name });
  }
  lines.splice(sep + 1, 0, ...rows);
  return { version: v, releases: lines.join("\n"), applied };
}

function main() {
  const arg = (k) => {
    const i = process.argv.indexOf(k);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const names = existsSync(FRAGMENT_DIR) ? readdirSync(FRAGMENT_DIR).filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md") : [];
  if (names.length === 0) {
    console.log("No release fragments: nothing to do.");
    return;
  }
  const fragments = names.map((n) => parseFragment(n, readFileSync(path.join(FRAGMENT_DIR, n), "utf8")));
  const pkgPath = path.join(root, "apps/web/package.json");
  const pkg = readFileSync(pkgPath, "utf8");
  const current = /"version":\s*"(\d+\.\d+\.\d+)"/.exec(pkg)?.[1];
  if (!current) throw new Error("apps/web/package.json has no version");
  const relPath = path.join(root, "docs/RELEASES.md");
  const out = assemble({ version: current, releases: readFileSync(relPath, "utf8"), fragments, date: arg("--date") ?? new Date().toISOString().slice(0, 10), pr: arg("--pr") ?? "" });
  writeFileSync(relPath, out.releases);
  writeFileSync(pkgPath, pkg.replace(/("version":\s*")\d+\.\d+\.\d+(")/, `$1${out.version}$2`));
  for (const n of names) unlinkSync(path.join(FRAGMENT_DIR, n));
  for (const a of out.applied) console.log(`${a.version}  <-  ${a.name}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
