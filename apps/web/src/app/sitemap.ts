import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/public-contact";

/** The public pages only. Add a page here when it is built; app screens, shared documents and invite links never belong in it. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/connector`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
