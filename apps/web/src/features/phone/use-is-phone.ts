"use client";

import { useEffect, useState } from "react";

export const PHONE_QUERY = "(max-width: 699px)";

/** True under 700 px (same breakpoint as the CSS). False on the server and for the first paint, so nothing mismatches. */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(PHONE_QUERY);
    const on = () => setPhone(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return phone;
}
