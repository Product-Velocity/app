import { readFileSync } from "node:fs";
import type { NextConfig } from "next";
import { parseReleaseLog } from "./src/lib/app-version";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
const releasesMarkdown = (() => {
  try {
    return readFileSync(new URL("../../docs/RELEASES.md", import.meta.url), "utf8");
  } catch {
    return "";
  }
})();
const recentReleases = JSON.stringify(parseReleaseLog(releasesMarkdown, 8));

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  // No script-src on purpose (it needs per-request nonces). form-action is left out: Chrome applies it to redirects after a form post,
  // which would break the OAuth consent hand-back to an AI assistant.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // shown at the bottom of the account menu so a tester knows which release (and which build) they are looking at
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_APP_BUILD: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7),
    NEXT_PUBLIC_APP_RELEASES: recentReleases,
  },
  transpilePackages: ["@pv/domain", "@pv/github"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // shared documents and files are opened by their secret address: not cached, not indexed, address not passed on
      { source: "/d/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "private, no-store" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      // invite links carry a secret in the path: never leak it through the Referer header
      {
        source: "/invite/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
