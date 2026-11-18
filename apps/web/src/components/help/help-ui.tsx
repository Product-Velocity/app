import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { SUPPORT_CONTACT } from "@/lib/public-contact";
import { HELP_REFERENCE, HELP_TOPICS, helpPath } from "./help-topics";
import type { Table } from "../help-content";

/**
 * The frame of every Help page. Help opens in its own browser tab, so it has its own header (logo, a way back to the app) and a side menu.
 * It needs no sign-in: it explains the product and holds nothing that belongs to a workspace.
 */
export function HelpPage({ current, title, intro, toc, children }: { current?: string; title: string; intro: string; toc?: { id: string; label: string }[]; children: React.ReactNode }) {
  return (
    <div className="hp-page">
      <header className="hp-head">
        <Link href="/help" aria-label="Product Velocity Help"><BrandLogo size={28} /></Link>
        <span className="hp-head-title">Help</span>
        <Link className="hp-back" href="/">Open the app</Link>
      </header>
      <div className="hp-body">
        <nav className="hp-nav" aria-label="Help topics">
          <Link href="/help" aria-current={current === undefined ? "page" : undefined}>Help home</Link>
          <p className="hp-nav-label">Topics</p>
          {HELP_TOPICS.map((t) => (
            <Link key={t.slug} href={helpPath(t.slug)} aria-current={current === t.slug ? "page" : undefined}><span className="hp-nav-num">{t.number}</span>{t.title}</Link>
          ))}
          <p className="hp-nav-label">Reference</p>
          {HELP_REFERENCE.map((r) => (
            <Link key={r.slug} href={helpPath(r.slug)} aria-current={current === r.slug ? "page" : undefined}>{r.title}</Link>
          ))}
        </nav>
        <main className="hp-main">
          <h1>{title}</h1>
          <p className="hp-intro">{intro}</p>
          {toc && toc.length > 0 && (
            <nav className="hp-toc" aria-label="On this page">
              <span>On this page</span>
              {toc.map((t) => <a key={t.id} href={`#${t.id}`}>{t.label}</a>)}
            </nav>
          )}
          {children}
          <footer className="hp-foot">Questions or something missing? Write to {SUPPORT_CONTACT.name}, <a href={`mailto:${SUPPORT_CONTACT.email}`}>{SUPPORT_CONTACT.email}</a>.</footer>
        </main>
      </div>
    </div>
  );
}

/** A section with a number-free heading and an anchor, so a page can be linked at the part that matters. */
export function HelpSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section className="hp-section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

/** A table from the shared help content. The first column is the row header. */
export function HelpTable({ caption, table }: { caption: string; table: Table }) {
  return (
    <div className="hp-table-wrap">
      <table className="hp-table">
        <caption>{caption}</caption>
        <thead><tr>{table.head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{table.rows.map((r) => <tr key={r[0]}>{r.map((c, i) => (i === 0 ? <th key={i} scope="row">{c}</th> : <td key={i}>{c}</td>))}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** Numbered cards, like the steps of a flow: number, title, a sentence, and short tags. */
export function HelpCards({ items, columns = 3 }: { items: { number?: string; title: string; text: string; pills?: string[]; href?: string }[]; columns?: 2 | 3 | 4 }) {
  return (
    <ul className={`hp-cards hp-cols-${columns}`}>
      {items.map((c) => (
        <li key={c.title} className="hp-card">
          {c.number && <span className="hp-num">{c.number}</span>}
          <h3>{c.href ? <Link href={c.href}>{c.title}</Link> : c.title}</h3>
          <p>{c.text}</p>
          {c.pills && c.pills.length > 0 && <p className="hp-pills">{c.pills.map((p) => <span key={p} className="hp-pill">{p}</span>)}</p>}
        </li>
      ))}
    </ul>
  );
}

/** The one sentence a page wants remembered. */
export function HelpCallout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <aside className="hp-callout">
      <strong>{title}</strong>
      <p>{children}</p>
    </aside>
  );
}

/** Where to find a thing in the app, in words. */
export function HelpWhere({ children }: { children: React.ReactNode }) {
  return <p className="hp-where"><span>Where</span> {children}</p>;
}

/** A pointer to a reference page that holds the long table, so the topic page stays short. */
export function HelpReference({ slug, children }: { slug: string; children: React.ReactNode }) {
  return <p className="hp-where"><span>Reference</span> <Link href={helpPath(slug)}>{children}</Link></p>;
}

export function HelpList({ items }: { items: string[] }) {
  return <ul className="hp-list">{items.map((i) => <li key={i}>{i}</li>)}</ul>;
}
