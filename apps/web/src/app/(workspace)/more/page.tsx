import Link from "next/link";
import { requireWorkspace } from "@/lib/session";
import { MORE_ENTRIES } from "@/features/phone/nav";
import { OpenOnComputer } from "@/components/open-on-computer";

export const metadata = { title: "More · Product Velocity" };

/** The phone's "More" screen: what is available on a phone, and what needs a computer (docs/29-MOBILE.md section 3). */
export default async function MorePage() {
  const { active } = await requireWorkspace("/more");
  const prefix = `/w/${active.tenantId}`;
  const here = MORE_ENTRIES.filter((e) => !e.desktopOnly);
  const later = MORE_ENTRIES.filter((e) => e.desktopOnly);
  return (
    <div className="page-narrow stack">
      <h1>More</h1>
      <ul className="more-list" aria-label="On your phone">
        {here.map((e) => (
          <li key={e.label}><Link href={`${prefix}${e.href}`} className="more-row"><strong>{e.label}</strong><span className="muted">{e.note}</span></Link></li>
        ))}
      </ul>
      <h2 className="more-sub">Needs a computer</h2>
      <ul className="more-list" aria-label="Needs a computer">
        {later.map((e) => (
          <li key={e.label} className="more-row more-row-later"><strong>{e.label}</strong><span className="muted">{e.note}</span></li>
        ))}
      </ul>
      <OpenOnComputer what="The full platform" />
    </div>
  );
}
