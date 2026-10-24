"use client";

import { setDateFormat, type DateFormat, DATE_FORMAT_VALUES } from "@pv/domain";

/**
 * Applies the person's date format once, before the page below renders, so every date shown, typed, pasted or imported follows it.
 * "locale" reads the browser's language.
 */
export function DatePrefs({ format }: { format: string }) {
  const f = (DATE_FORMAT_VALUES as readonly string[]).includes(format) ? (format as DateFormat) : "locale";
  // the server module is shared between people, so only the browser sets it
  if (typeof window !== "undefined") setDateFormat(f, navigator.language);
  return null;
}
