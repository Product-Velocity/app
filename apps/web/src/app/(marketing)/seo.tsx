import Script from "next/script";
import { SITE_URL } from "@/lib/public-contact";

/** What the homepage says about itself to search engines and AI assistants. Keep in step with the page text and llms.txt. */
export const HOME_TITLE = "Product Velocity: one source of truth for PMs and their AI";
export const HOME_DESCRIPTION = "Product Velocity is the single source of truth for product managers and their AI: one roadmap from company objective to delivery ticket, on top of Jira and GitHub, with alignment, decision gates and tracked outcomes.";

export const homeMetadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: SITE_URL, siteName: "Product Velocity", title: HOME_TITLE, description: HOME_DESCRIPTION, locale: "en" },
  twitter: { card: "summary_large_image", title: HOME_TITLE, description: HOME_DESCRIPTION },
} as const;

/** Structured data (schema.org). No ratings, prices or customer claims: only what is true today. */
export const HOME_JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": `${SITE_URL}/#org`, name: "Product Velocity", url: SITE_URL, logo: `${SITE_URL}/brand/icon-192.png` },
    { "@type": "WebSite", "@id": `${SITE_URL}/#site`, url: SITE_URL, name: "Product Velocity", description: HOME_DESCRIPTION, inLanguage: "en", publisher: { "@id": `${SITE_URL}/#org` } },
    {
      "@type": "SoftwareApplication", "@id": `${SITE_URL}/#app`, name: "Product Velocity", url: SITE_URL, applicationCategory: "BusinessApplication", operatingSystem: "Web",
      description: "A multi-tenant product management platform: one roadmap and stack rank, alignment on priorities, decision gates, capacity-aware planning, two-way sync with Jira and GitHub, reports per audience and outcomes after launch. Works with your own AI assistant, including Claude.",
      publisher: { "@id": `${SITE_URL}/#org` },
    },
  ],
};

/** Google Tag Manager (analytics), loaded only on the public homepage and only when NEXT_PUBLIC_GTM_ID is set to a real container id.
 *  Consent Mode v2 starts with everything denied; the consent banner or CMP configured in the container grants it. */
const GTM_ID = /^GTM-[A-Z0-9]{4,12}$/.test(process.env.NEXT_PUBLIC_GTM_ID ?? "") ? (process.env.NEXT_PUBLIC_GTM_ID as string) : null;

export function GoogleTagManager() {
  if (!GTM_ID) return null;
  return (
    <>
      <Script id="gtm-consent" strategy="beforeInteractive">{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',wait_for_update:500});`}</Script>
      <Script id="gtm" strategy="afterInteractive">{`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`}</Script>
    </>
  );
}

export function GoogleTagManagerNoscript() {
  if (!GTM_ID) return null;
  return <noscript><iframe src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`} height="0" width="0" style={{ display: "none", visibility: "hidden" }} title="Google Tag Manager" /></noscript>;
}
