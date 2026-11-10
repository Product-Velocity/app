import type { Metadata, Viewport } from "next";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@/styles/globals.css";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export const metadata: Metadata = {
  title: "Product Velocity",
  description: "AI-first product management platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
