"use client";

import { useId, useState } from "react";
import { checkPassword } from "@/lib/password";

type FieldProps = {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
  describedBy?: string;
};

/** Password input with a Show/Hide button (text, not just an icon). */
export function PasswordField({ name, label, value, onChange, autoComplete, autoFocus, describedBy }: FieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="pw-wrap">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          aria-describedby={describedBy}
          required
          spellCheck={false}
          autoCapitalize="none"
        />
        <button
          type="button"
          className="pw-toggle"
          aria-pressed={visible}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

const SEGMENTS = [0, 1, 2, 3];

/** Password + confirmation, live strength meter and requirements checklist. */
export function NewPasswordFields(props: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  email?: string;
  autoFocus?: boolean;
}) {
  const { password, confirm } = props;
  const check = checkPassword(password, { email: props.email });
  const metaId = useId();
  const matches = password === confirm;
  return (
    <>
      <PasswordField
        name="password"
        label="Password"
        value={password}
        onChange={props.onPassword}
        autoComplete="new-password"
        autoFocus={props.autoFocus}
        describedBy={metaId}
      />
      <div id={metaId} className="pw-meta">
        <div className="meter" aria-hidden="true">
          {SEGMENTS.map((i) => (
            <span
              key={i}
              className={`meter-seg ${password && i <= check.strength.score ? `lvl-${check.strength.score}` : ""}`}
            />
          ))}
        </div>
        <p className="pw-strength" aria-live="polite">
          Strength: <strong>{password ? check.strength.label : "Not entered yet"}</strong>
        </p>
        <ul className="checklist">
          {check.requirements.map((r) => (
            <li key={r.id} className={r.met ? "met" : ""}>
              <span aria-hidden="true">{r.met ? "✓" : "○"}</span> {r.label}
              <span className="visually-hidden">{r.met ? " (met)" : " (not met yet)"}</span>
            </li>
          ))}
        </ul>
      </div>
      <PasswordField
        name="confirm"
        label="Repeat password"
        value={confirm}
        onChange={props.onConfirm}
        autoComplete="new-password"
      />
      {confirm.length > 0 && (
        <p role="status" className={matches ? "match ok" : "match bad"}>
          {matches ? "✓ Passwords match" : "✗ Passwords do not match yet"}
        </p>
      )}
    </>
  );
}

/** True when the new password may be submitted. */
export function canSubmitNewPassword(password: string, confirm: string, email?: string): boolean {
  return checkPassword(password, { email }).ok && password === confirm;
}
