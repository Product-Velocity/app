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
  /** Apple Passwords / Safari hint so the generated password fits our rules. */
  passwordRules?: string;
};

/** Password input with a Show/Hide button (text, not just an icon). */
export function PasswordField({ name, label, value, onChange, autoComplete, autoFocus, describedBy, passwordRules }: FieldProps) {
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
          // `passwordrules` is read by Apple Passwords/Safari; React passes unknown lowercase attributes through
          {...(passwordRules ? { passwordrules: passwordRules } : {})}
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

/** Rules we tell password managers about; they match `checkPassword` (12+ characters, mixed). */
export const PASSWORD_RULES = "minlength: 12; max-consecutive: 3; required: lower; required: upper; required: digit;";

/**
 * One new-password field with live strength meter and requirements checklist.
 * Deliberately no "repeat password" field: the Show button replaces it, and
 * password managers (Apple Passwords, 1Password, Chrome) fill and save a
 * single `new-password` field reliably.
 */
export function NewPasswordFields(props: {
  password: string;
  onPassword: (v: string) => void;
  email?: string;
  autoFocus?: boolean;
  label?: string;
}) {
  const { password } = props;
  const check = checkPassword(password, { email: props.email });
  const metaId = useId();
  const hint =
    !password
      ? "Longer is stronger. Your password manager can suggest a strong one."
      : check.strength.label === "Strong"
        ? "Strong. Your password manager can save it when you continue."
        : check.ok
          ? "Good enough to use. Add a few more characters or a passphrase to reach Strong."
          : "Keep going: follow the checklist below.";
  return (
    <>
      <PasswordField
        name="password"
        label={props.label ?? "Password"}
        value={password}
        onChange={props.onPassword}
        autoComplete="new-password"
        autoFocus={props.autoFocus}
        describedBy={metaId}
        passwordRules={PASSWORD_RULES}
      />
      <div id={metaId} className="pw-meta">
        <div className="pw-meter-row">
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
        </div>
        <p className="hint">{hint}</p>
        <ul className="checklist">
          {check.requirements.map((r) => (
            <li key={r.id} className={r.met ? "met" : ""}>
              <span aria-hidden="true">{r.met ? "✓" : "○"}</span> {r.label}
              <span className="visually-hidden">{r.met ? " (met)" : " (not met yet)"}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/** True when the new password may be submitted. */
export function canSubmitNewPassword(password: string, email?: string): boolean {
  return checkPassword(password, { email }).ok;
}
