"use client";

import { useState } from "react";
import { EMAIL_TEMPLATES, renderTemplate, type EmailKey, type TemplateText } from "@/lib/email/registry/registry";
import { MACRO_CATALOG, sampleValues } from "@/lib/email/registry/macros";
import { FIELD_LABELS, editableFields, validateTemplateText } from "@/lib/email/registry/validate";

type Action = (form: FormData) => void | Promise<void>;

/**
 * Wording editor with a live preview (issue #370 phase 4). Text only: the fields take plain words and {{macros}} from the list of this
 * email; HTML, links and unknown macros are refused as you type, and the save, publish and test buttons stay off until the wording is fine.
 * The frame, links, tokens, recipients and the trigger-to-template mapping are not here and cannot be edited.
 */
export function TemplateEditor({ templateKey, initial, siteUrl, isAuth, hasDraft, hasPublished, saveAction, testAction, publishAction, discardAction }: {
  templateKey: EmailKey; initial: TemplateText; siteUrl: string; isAuth: boolean; hasDraft: boolean; hasPublished: boolean;
  saveAction: Action; testAction: Action; publishAction: Action; discardAction: Action;
}) {
  const t = EMAIL_TEMPLATES.find((x) => x.key === templateKey)!;
  const editable = editableFields(t);
  const [text, setText] = useState<TemplateText>(initial);
  const [view, setView] = useState<"desktop" | "phone" | "text">("desktop");
  // cheap to compute on every keystroke, so no memo (the React compiler also manages that)
  const problems = validateTemplateText(t, text);
  const dirty = (Object.keys(initial) as (keyof TemplateText)[]).some((f) => text[f] !== initial[f]);
  // an invalid draft previews the code default so nothing odd is ever rendered
  const preview = renderTemplate(t, { values: { ...sampleValues(t.macros), ...(t.sample ?? {}) }, siteUrl, buttonUrl: t.button ? `${siteUrl}/auth/callback?sample=1` : null, override: problems.length > 0 ? null : text });
  const field = (f: keyof TemplateText, multiline = false) => {
    if (f === "button" && t.button === null) return null;
    const off = !editable.includes(f);
    const id = `f-${f}`;
    const value = text[f] ?? "";
    const set = (v: string) => setText((s) => ({ ...s, [f]: v }));
    return (
      <div className="field" key={f}>
        <label htmlFor={id}>{FIELD_LABELS[f]}{off ? " (written by the workspace admin for each mailing)" : ""}</label>
        {multiline
          ? <textarea id={id} name={f} rows={7} value={value} disabled={off} onChange={(e) => set(e.target.value)} style={{ width: "100%" }} />
          : <input id={id} name={f} type="text" value={value} disabled={off} onChange={(e) => set(e.target.value)} style={{ width: "100%" }} />}
      </div>
    );
  };
  const blocked = problems.length > 0;
  return (
    <div style={{ display: "grid", gap: 24, gridTemplateColumns: "minmax(280px, 1fr) minmax(320px, 1fr)", alignItems: "start" }}>
      <div>
        {isAuth && (
          <p role="alert" className="notice notice-error" data-testid="auth-warning">
            This is a sign-in email. Once published, everyone who signs in, creates an account or resets a password will see this wording.
          </p>
        )}
        <form className="stack" data-testid="template-form">
          {field("subject")}
          {field("preheader")}
          {field("heading")}
          {field("body", true)}
          {field("button")}
          {field("note")}
          <p className="muted">
            Macros you can use here:{" "}
            {t.macros.map((m) => <code key={m} title={MACRO_CATALOG[m].label}>{`{{${m}}} `}</code>)}
            . Words only: no HTML, no links, no images. The button, its link and the layout are fixed.
          </p>
          {blocked && (
            <ul role="alert" className="error" data-testid="problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
          )}
          <div className="row-form">
            <button className="btn btn-primary" type="submit" formAction={saveAction} disabled={blocked || !dirty} data-testid="save-draft">Save draft</button>
            <button className="btn" type="submit" formAction={testAction} disabled={blocked} data-testid="send-test">Send test to me</button>
          </div>
          <p className="muted">A test goes only to your own address, with &ldquo;Test:&rdquo; in the subject, and uses sample data. It sends the wording above, saved or not.</p>
        </form>
        <div className="row-form" style={{ marginTop: 12 }}>
          <form action={publishAction}>
            <button className="btn btn-primary" type="submit" disabled={!hasDraft || dirty} data-testid="publish" title={dirty ? "Save the draft first" : undefined}>
              Publish draft
            </button>
          </form>
          <form action={discardAction}><button className="btn" type="submit" disabled={!hasDraft}>Discard draft</button></form>
        </div>
        <p className="muted">
          {hasDraft ? "A draft does not change what is sent until you publish it." : "No draft yet."} {hasPublished ? "The published wording is being sent." : "Nothing is published: the code default is being sent."}
        </p>
      </div>
      <div>
        <nav aria-label="Preview options" className="tabs">
          <button type="button" className="tab" aria-pressed={view === "desktop"} onClick={() => setView("desktop")}>Desktop</button>
          <button type="button" className="tab" aria-pressed={view === "phone"} onClick={() => setView("phone")}>Phone</button>
          <button type="button" className="tab" aria-pressed={view === "text"} onClick={() => setView("text")}>Plain text</button>
        </nav>
        <p className="muted" role="note">Live preview with sample data. It never sends.</p>
        <p data-testid="preview-subject"><strong>Subject:</strong> {preview.subject}</p>
        {view === "text" ? (
          <pre data-testid="preview-text" style={{ whiteSpace: "pre-wrap", border: "1px solid #d1d5db", padding: 16 }}>{preview.text}</pre>
        ) : (
          <iframe title={`Preview of ${t.name}`} data-testid="preview-frame" sandbox="" srcDoc={preview.html}
            style={{ width: view === "phone" ? 375 : "100%", maxWidth: "100%", height: 720, border: "1px solid #d1d5db", background: "#f3f4f6" }} />
        )}
      </div>
    </div>
  );
}
