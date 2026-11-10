import { statusTone, type Tone } from "./status-tone";

/** A compact pill: the word is always shown, colour is only an extra, no icon. */
export function StatusPill({ value, tone, className }: { value: string; tone?: Tone; className?: string }) {
  if (!value) return null;
  return <span className={`pill tone-${tone ?? statusTone(value)}${className ? ` ${className}` : ""}`}>{value}</span>;
}
