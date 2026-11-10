import type { MetadataRoute } from "next";

/**
 * Makes Product Velocity installable ("Add to Home Screen") and a target of the share sheet on Android: sharing text or a link from another
 * app opens /share, which prefills the phone quick-add (docs/29-MOBILE.md). No push notifications (Ashu, 2026-11-09), no service worker.
 * Apple's Safari does not support share targets yet; there the app installs but is not listed in the share sheet.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Product Velocity",
    short_name: "Velocity",
    description: "One roadmap for humans and AI.",
    start_url: "/for-you",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2270ED",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    share_target: { action: "/share", method: "GET", params: { title: "title", text: "text", url: "url" } },
  } as MetadataRoute.Manifest;
}
