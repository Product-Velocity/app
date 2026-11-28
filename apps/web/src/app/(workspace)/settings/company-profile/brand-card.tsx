"use client";

import { useActionState, useState } from "react";
import { derivePalette, normalizeHex } from "@pv/domain";
import { detectFromFile, detectFromWebsite, removeLogo, saveBrand, setBrandStatus, uploadLogo, useLogoFromUrl, type BrandState } from "./brand-actions";

export type BrandRow = {
  display_name: string | null; primary_color: string | null; accent_color: string | null; heading_font: string | null; body_font: string | null;
  source: string | null; source_note: string | null; status: "draft" | "confirmed"; ai_draft: boolean; version: number; confirmed_at: string | null;
  use_on_voting: boolean; use_in_app: boolean; has_logo: boolean;
};

const Msg = ({ s }: { s: BrandState }) => (
  <>
    {s?.error && <p role="alert" className="error">{s.error}</p>}
    {s?.ok && <p role="status" className="notice">{s.ok}</p>}
  </>
);

/**
 * The company brand (issue #750): logo, main and accent colour, fonts, where it was found, and whether voting screens and the interface use it. Detection only proposes;
 * the admin picks what is right, saves a draft and confirms it. The preview shows the colours as the screens will use them, after the contrast rules.
 */
export function BrandCard({ brand, companyUrl, logoDataUrl, canEdit }: { brand: BrandRow | null; companyUrl: string | null; logoDataUrl: string | null; canEdit: boolean }) {
  const [name, setName] = useState(brand?.display_name ?? "");
  const [primary, setPrimary] = useState(brand?.primary_color ?? "");
  const [accent, setAccent] = useState(brand?.accent_color ?? "");
  const [heading, setHeading] = useState(brand?.heading_font ?? "");
  const [body, setBody] = useState(brand?.body_font ?? "");
  const [source, setSource] = useState<{ source: string; note: string; detected: boolean }>({ source: brand?.source ?? "typed", note: brand?.source_note ?? "", detected: false });
  const [saveState, save, saving] = useActionState<BrandState, FormData>(saveBrand, null);
  const [statusState, setStatus, settingStatus] = useActionState<BrandState, FormData>(setBrandStatus, null);
  const [siteState, detectSite, detecting] = useActionState<BrandState, FormData>(detectFromWebsite, null);
  const [fileState, detectFile, reading] = useActionState<BrandState, FormData>(detectFromFile, null);
  const [logoState, upload, uploading] = useActionState<BrandState, FormData>(uploadLogo, null);
  const [urlLogoState, useUrlLogo, fetchingLogo] = useActionState<BrandState, FormData>(useLogoFromUrl, null);
  const [removeState, remove, removing] = useActionState<BrandState, FormData>(async () => removeLogo(), null);

  const proposal = (fileState?.proposal ?? siteState?.proposal) ?? null;
  const pal = primary ? derivePalette(primary, accent || undefined) : null;
  const vars = pal && pal.ok ? ({ "--b": pal.palette.brand, "--bs": pal.palette.brandStrong, "--bt": pal.palette.brandTint, "--bo": pal.palette.onBrand, "--br": pal.palette.ring } as React.CSSProperties) : undefined;
  const from = (p: NonNullable<typeof proposal>) => setSource({ source: p.source, note: p.sourceNote, detected: true });
  const status = brand?.status ?? null;

  return (
    <section className="card stack" aria-labelledby="brand-title" id="brand">
      <h2 id="brand-title">Brand</h2>
      <p className="muted">
        Your logo, colours and fonts. A confirmed brand can dress the voting screens and the voter emails, and, where you switch it on, the whole interface for your workspace. It is never sent to GitHub or Jira.{!canEdit && " Only admins can change it."}
      </p>
      <p role="status">
        {!brand && <strong>Not set up yet.</strong>}
        {status === "draft" && <strong>{brand?.ai_draft ? "AI proposal, not confirmed." : "Draft, not confirmed."} It is not used anywhere yet.</strong>}
        {status === "confirmed" && <strong>Confirmed. Used {brand?.use_on_voting ? "on voting screens" : "nowhere yet"}{brand?.use_in_app ? " and in the interface" : ""}.</strong>}
      </p>

      {canEdit && (
        <div className="stack">
          <h3>Find it</h3>
          <form action={detectSite} className="row-form" aria-label="Read the website">
            <div className="field">
              <label htmlFor="brand-url">Company website</label>
              <input id="brand-url" name="url" type="url" defaultValue={companyUrl ?? ""} placeholder="https://www.example.com" />
            </div>
            <button className="btn" type="submit" disabled={detecting}>{detecting ? "Reading…" : "Read the website"}</button>
          </form>
          <Msg s={siteState} />
          <form action={detectFile} className="row-form" aria-label="Read a presentation or Word file">
            <div className="field">
              <label htmlFor="brand-file">A shared presentation or Word file (.pptx, .potx, .docx, .dotx)</label>
              <input id="brand-file" name="theme" type="file" accept=".pptx,.potx,.docx,.dotx" />
            </div>
            <button className="btn" type="submit" disabled={reading}>{reading ? "Reading…" : "Read its theme"}</button>
          </form>
          <Msg s={fileState} />

          {proposal && (
            <div className="notice stack" role="region" aria-label="What was found">
              <p><strong>Found{proposal.sourceNote ? ` in ${proposal.sourceNote}` : ""}.</strong> Use what is right.</p>
              {proposal.name && <p>Name: <strong>{proposal.name}</strong> <button type="button" className="btn" onClick={() => { setName(proposal.name!); from(proposal); }}>Use as the name</button></p>}
              {proposal.colors.length > 0 && (
                <div>
                  <p>Colours</p>
                  <ul className="brand-swatches">
                    {proposal.colors.map((c) => (
                      <li key={c}>
                        <span className="brand-swatch" style={{ background: c }} aria-hidden="true" /> <code>{c}</code>{" "}
                        <button type="button" className="btn" onClick={() => { setPrimary(c); from(proposal); }}>Main</button>{" "}
                        <button type="button" className="btn" onClick={() => { setAccent(c); from(proposal); }}>Accent</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {proposal.fonts.length > 0 && (
                <div>
                  <p>Fonts</p>
                  <ul className="brand-swatches">
                    {proposal.fonts.map((f) => (
                      <li key={f}>{f}{" "}
                        <button type="button" className="btn" onClick={() => { setHeading(f); from(proposal); }}>Headings</button>{" "}
                        <button type="button" className="btn" onClick={() => { setBody(f); from(proposal); }}>Body text</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {proposal.logoDataUrl && (
                <form action={upload} className="row-form" aria-label="Use the logo from the file">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={proposal.logoDataUrl} alt="The logo found in the file" className="brand-logo-preview" />
                  <input type="hidden" name="logo_b64" value={proposal.logoDataUrl} />
                  <button className="btn" type="submit" disabled={uploading}>Use this logo</button>
                </form>
              )}
              {proposal.logoCandidates.length > 0 && (
                <div>
                  <p>Logos on the website</p>
                  <ul className="brand-swatches">
                    {proposal.logoCandidates.map((u) => (
                      <li key={u}>
                        <form action={useUrlLogo} className="row-form" aria-label={`Use the logo ${u}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={u} alt="" className="brand-logo-preview" referrerPolicy="no-referrer" />
                          <input type="hidden" name="url" value={u} />
                          <button className="btn" type="submit" disabled={fetchingLogo}>Use this logo</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {proposal.notes.map((n) => <p key={n} className="muted">{n}</p>)}
            </div>
          )}
        </div>
      )}

      <h3>Logo</h3>
      <div className="row-form">
        {logoDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoDataUrl} alt="The company logo" className="brand-logo-preview" />
        ) : <p className="muted">No logo yet. The voting screens then show your name as text.</p>}
        {canEdit && logoDataUrl && (
          <form action={remove}><button className="btn btn-danger-quiet" type="submit" disabled={removing}>Remove the logo</button></form>
        )}
      </div>
      {canEdit && (
        <form action={upload} className="row-form" aria-label="Upload a logo">
          <div className="field">
            <label htmlFor="brand-logo">Upload a logo (PNG, JPG, WebP or SVG, up to 1 MB)</label>
            <input id="brand-logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" />
          </div>
          <button className="btn" type="submit" disabled={uploading}>{uploading ? "Saving…" : "Upload"}</button>
        </form>
      )}
      <Msg s={logoState} /><Msg s={urlLogoState} /><Msg s={removeState} />

      <form action={save} className="stack">
        <h3>Name, colours and fonts</h3>
        <input type="hidden" name="source" value={source.source} />
        <input type="hidden" name="source_note" value={source.note} />
        <input type="hidden" name="detected" value={source.detected ? "1" : "0"} />
        <div className="field">
          <label htmlFor="brand-name">Name shown to voters</label>
          <input id="brand-name" name="display_name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} disabled={!canEdit} placeholder="Your company" />
        </div>
        <div className="row-form">
          <div className="field">
            <label htmlFor="brand-primary">Main colour</label>
            <input id="brand-primary" name="primary_color" value={primary} onChange={(e) => setPrimary(e.target.value)} placeholder="#2270ED" maxLength={20} disabled={!canEdit} aria-describedby="brand-colour-help" />
          </div>
          {canEdit && <input type="color" aria-label="Pick the main colour" value={normalizeHex(primary) ?? "#2270ed"} onChange={(e) => setPrimary(e.target.value)} className="brand-picker" />}
          <div className="field">
            <label htmlFor="brand-accent">Accent colour (optional)</label>
            <input id="brand-accent" name="accent_color" value={accent} onChange={(e) => setAccent(e.target.value)} placeholder="#F59E0B" maxLength={20} disabled={!canEdit} />
          </div>
          {canEdit && <input type="color" aria-label="Pick the accent colour" value={normalizeHex(accent) ?? "#f59e0b"} onChange={(e) => setAccent(e.target.value)} className="brand-picker" />}
        </div>
        <p id="brand-colour-help" className="hint">Hex colours such as #2270ED. Whatever you choose is checked for readability (WCAG AA); the preview shows what the screens will actually use.</p>
        <div className="row-form">
          <div className="field">
            <label htmlFor="brand-heading">Heading font</label>
            <input id="brand-heading" name="heading_font" value={heading} onChange={(e) => setHeading(e.target.value)} maxLength={80} disabled={!canEdit} />
          </div>
          <div className="field">
            <label htmlFor="brand-body">Body font</label>
            <input id="brand-body" name="body_font" value={body} onChange={(e) => setBody(e.target.value)} maxLength={80} disabled={!canEdit} />
          </div>
        </div>
        <p className="hint">Fonts are used in documents an AI co-worker writes for you. Screens keep a readable system font.</p>

        {pal && !pal.ok && <p role="alert" className="error">{pal.error}</p>}
        {pal && pal.ok && (
          <div className="brand-preview" style={vars} aria-label="Preview of the colours as the screens use them">
            <p><strong>Preview</strong></p>
            <div className="row-form">
              <span className="brand-preview-button">Submit my vote</span>
              <span className="brand-preview-link">A link in brand colour</span>
              <span className="brand-preview-selected">A selected choice</span>
            </div>
            {pal.palette.notes.map((n) => <p key={n} className="muted">{n}</p>)}
          </div>
        )}

        <fieldset className="stack">
          <legend>Where to use it (once confirmed)</legend>
          <label className="check"><input type="checkbox" name="use_on_voting" defaultChecked={brand?.use_on_voting ?? false} disabled={!canEdit} /> On voting screens and voter emails (each session can still opt out)</label>
          <label className="check"><input type="checkbox" name="use_in_app" defaultChecked={brand?.use_in_app ?? false} disabled={!canEdit} /> In the Product Velocity interface for everyone in this workspace</label>
        </fieldset>
        <Msg s={saveState} />
        {saveState?.notes?.map((n) => <p key={n} className="muted">{n}</p>)}
        {canEdit && <div><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save as a draft"}</button></div>}
      </form>

      {canEdit && brand && (
        <form action={setStatus} className="stack">
          <input type="hidden" name="status" value={status === "confirmed" ? "draft" : "confirmed"} />
          <Msg s={statusState} />
          <div><button className={status === "confirmed" ? "btn" : "btn btn-primary"} type="submit" disabled={settingStatus}>{status === "confirmed" ? "Reopen as a draft" : "Confirm this brand"}</button></div>
          <p className="hint">Only an admin confirms. Claude can propose a brand but never confirm it, and a change by Claude sends a confirmed brand back to draft.</p>
        </form>
      )}
    </section>
  );
}
