import Link from "next/link";
import { requireWorkspace } from "@/lib/session";
import { MORE_ENTRIES } from "@/features/phone/nav";

export const metadata = { title: "More · Product Velocity" };

/** The phone's More screen: account, help and the shortcuts that are not in the bottom bar (issue #635). */
export default async function MorePage() {
  const { active } = await requireWorkspace("/more");
  const prefix = `/w/${active.tenantId}`;
  return (
    <div className="page-narrow stack">
      <h1>More</h1>
      <ul className="more-list" aria-label="More">
        {MORE_ENTRIES.map((e) => (
          <li key={e.label}><Link href={e.href.startsWith("/help") ? e.href : `${prefix}${e.href}`} className="more-row"><strong>{e.label}</strong><span className="muted">{e.note}</span></Link></li>
        ))}
      </ul>
    </div>
  );
}
