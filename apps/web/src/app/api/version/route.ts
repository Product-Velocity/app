import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { parseReleaseLog, type ReleaseEntry, type VersionInfo } from "@/lib/app-version";

export const dynamic = "force-dynamic";

function loadReleases(): ReleaseEntry[] {
  try {
    const fromEnv = process.env.NEXT_PUBLIC_APP_RELEASES;
    if (fromEnv) {
      const parsed = JSON.parse(fromEnv) as ReleaseEntry[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // fall through to disk read
  }
  for (const rel of ["../../docs/RELEASES.md", "docs/RELEASES.md"]) {
    try {
      const md = readFileSync(path.resolve(process.cwd(), rel), "utf8");
      const entries = parseReleaseLog(md, 8);
      if (entries.length > 0) return entries;
    } catch {
      // try next path
    }
  }
  return [];
}

/**
 * Uncached version endpoint polled by open browser tabs (on tab focus and periodically)
 * so the app can show a manual "Update available · Refresh" prompt and what changed in the release.
 */
export async function GET() {
  const releases = loadReleases();
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? releases[0]?.version ?? "0.0.0";
  const build = process.env.NEXT_PUBLIC_APP_BUILD ?? "";
  const body: VersionInfo = {
    version,
    build,
    latest: releases[0] ?? null,
    releases,
  };
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
