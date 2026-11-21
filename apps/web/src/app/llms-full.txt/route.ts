import { SITE_URL } from "@/lib/public-contact";
import { sectionText } from "../(marketing)/plain-text";
import { HOME_DESCRIPTION } from "../(marketing)/seo";
import { PV2_ALIGN, PV2_LIFECYCLE, PV2_LOOP, PV2_NOT, PV2_SOLUTION, PV2_SOURCE, PV2_TRANSPARENCY, PV2_VIEWS_TEXT, PV2_WHY_NOW } from "../(marketing)/art-v2";

export function GET() {
  const body = [PV2_WHY_NOW, PV2_SOURCE, PV2_LOOP, PV2_NOT, PV2_VIEWS_TEXT, PV2_TRANSPARENCY, PV2_SOLUTION, PV2_ALIGN, PV2_LIFECYCLE].map(sectionText).join("\n\n");
  const text = `# Product Velocity: agentic product management platform

> ${HOME_DESCRIPTION}

Source: ${SITE_URL}/ (the homepage). A shorter summary is at ${SITE_URL}/llms.txt. Product pictures on the page use example data from a fictional company (Meridian Media).

${body}

## Join us
Product Velocity is built by a group of product leaders for their own daily work, not as a business model. Joining is by request on the homepage: ${SITE_URL}/#early-access
`;
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
