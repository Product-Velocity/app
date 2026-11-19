import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/public-contact";

/** Search engines and AI crawlers may read the public pages only; everything else is the signed-in app, shared documents or secret links. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/$", "/connector", "/privacy", "/contact", "/llms.txt", "/sitemap.xml"], disallow: ["/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
