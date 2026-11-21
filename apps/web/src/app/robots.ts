import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/public-contact";

/** Search engines and AI crawlers may read the public pages only; everything else is the signed-in app, shared documents or secret links. */
const PUBLIC_PATHS = ["/$", "/connector", "/privacy", "/contact", "/llms.txt", "/llms-full.txt", "/sitemap.xml"];
/** AI search and assistant crawlers, named so the intent is explicit: they may read the same public pages and nothing else (/classic is noindex and stays off the list). */
const AI_CRAWLERS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Google-Extended", "Applebot-Extended"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: PUBLIC_PATHS, disallow: ["/"] },
      { userAgent: AI_CRAWLERS, allow: PUBLIC_PATHS, disallow: ["/"] },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
