import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { SUPPORT_CONTACT } from "@/lib/public-contact";

/** The frame of the pages anyone can open without signing in (/connector, /privacy): name, two links, content, and who to write to. */
export function PublicPage({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <div className="doc-page">
      <header className="doc-head">
        <Link href="/connector" aria-label="Product Velocity"><BrandLogo size={28} /></Link>
        <nav aria-label="Public pages">
          <Link href="/connector">Connect Claude</Link>
          <Link href="/privacy">Privacy policy</Link>
        </nav>
      </header>
      <main className="doc-main">
        <h1>{title}</h1>
        {intro && <p className="doc-intro">{intro}</p>}
        {children}
      </main>
      <footer className="doc-foot">
        <p>Questions about Product Velocity or your data: {SUPPORT_CONTACT.name}, <a href={`mailto:${SUPPORT_CONTACT.email}`}>{SUPPORT_CONTACT.email}</a>.</p>
      </footer>
    </div>
  );
}
