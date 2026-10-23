import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // shown at the bottom of the account menu so a tester knows which release (and which build) they are looking at
  env: { NEXT_PUBLIC_APP_VERSION: version, NEXT_PUBLIC_APP_BUILD: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) },
  transpilePackages: ["@pv/domain", "@pv/github"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // invite links carry a secret in the path: never leak it through the Referer header
      {
        source: "/invite/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
