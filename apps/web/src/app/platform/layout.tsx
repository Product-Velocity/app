import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/session";
import { BrandLogo } from "@/components/brand-logo";

export const metadata = { title: "Platform · Product Velocity" };

/** Internal area for platform admins (docs/15 section 5b). Everybody else gets "not found": the console's existence is not confirmed to them. */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requirePlatformAdmin("/platform");
  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand-lockup"><BrandLogo /></span>
        <nav aria-label="Platform" className="tabs">
          <Link className="tab" href="/platform">All accounts</Link>
          <Link className="tab" href="/platform/audit">Audit log</Link>
          <Link className="tab" href="/platform/settings">Access settings</Link>
        </nav>
        <span className="muted">{user.email}</span>
        <Link className="btn" href="/portfolio">My workspace</Link>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
