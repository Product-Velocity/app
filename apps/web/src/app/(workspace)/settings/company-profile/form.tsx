"use client";

import { useActionState } from "react";
import { PROFILE_SECTIONS } from "@pv/domain";
import { saveProfile, setProfileStatus, type ProfileState } from "./actions";

export function ProfileForm({ sections, version, canEdit, status }: { sections: Record<string, string>; version: number | null; canEdit: boolean; status: "none" | "draft" | "confirmed" }) {
  const [state, save, saving] = useActionState<ProfileState, FormData>(saveProfile, null);
  const [cstate, confirm, confirming] = useActionState<ProfileState, FormData>(setProfileStatus, null);
  return (
    <>
      <form action={save} className="stack">
        <input type="hidden" name="version" value={version ?? ""} />
        {PROFILE_SECTIONS.map((s) => (
          <div className="field" key={s.key}>
            <label htmlFor={`cp-${s.key}`}>{s.title}</label>
            <textarea id={`cp-${s.key}`} name={s.key} rows={s.key === "voice" || s.key === "industry" ? 3 : 5} defaultValue={sections[s.key] ?? ""} maxLength={8000} disabled={!canEdit} aria-describedby={`cp-${s.key}-help`} />
            <p id={`cp-${s.key}-help`} className="hint">{s.covers}</p>
          </div>
        ))}
        {state?.error && <p role="alert" className="error">{state.error}</p>}
        {state?.saved && <p role="status" className="notice">{state.saved}</p>}
        {canEdit && <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save profile"}</button>}
      </form>
      {canEdit && status !== "none" && (
        <form action={confirm} className="stack" style={{ marginTop: 16 }}>
          <input type="hidden" name="status" value={status === "confirmed" ? "draft" : "confirmed"} />
          {cstate?.error && <p role="alert" className="error">{cstate.error}</p>}
          {cstate?.saved && <p role="status" className="notice">{cstate.saved}</p>}
          <button className={status === "confirmed" ? "btn" : "btn btn-primary"} type="submit" disabled={confirming}>
            {status === "confirmed" ? "Reopen as draft" : "Confirm this profile"}
          </button>
          {status !== "confirmed" && <p className="hint">Save your edits first. Confirming says this is right and safe for Claude to use; Claude cannot do it.</p>}
        </form>
      )}
    </>
  );
}
