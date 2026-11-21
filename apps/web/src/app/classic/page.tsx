import type { Metadata } from "next";
import { ClassicHome } from "../(marketing)/home-classic";
import { HOME_TITLE } from "../(marketing)/seo";
import { getViewer } from "../(marketing)/viewer";

/**
 * The previous homepage, kept available at /classic (issue #574). It is not for search: noindex, canonical to the homepage, left out of the
 * sitemap and llms.txt, and robots keeps crawlers off it with the rest of the app.
 */
export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  alternates: { canonical: "/" },
  robots: { index: false, follow: false },
};

export default async function Classic() {
  return <ClassicHome viewer={await getViewer()} />;
}
