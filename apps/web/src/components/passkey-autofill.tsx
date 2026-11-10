"use client";

import { useEffect } from "react";
import { autofillSupported, createPasskeyClient, rememberPasskeyHere, runPasskeyAutofill } from "@/lib/supabase/passkey";

/**
 * Renders nothing. Lets the browser offer a passkey in the email field of the sign-in form (the field has autocomplete="username webauthn").
 * Choosing one signs in; with no passkey nothing appears.
 */
export function PasskeyAutofill({ next }: { next: string }) {
  useEffect(() => {
    let off = false;
    void (async () => {
      if (!(await autofillSupported()) || off) return;
      if (await runPasskeyAutofill(createPasskeyClient())) {
        rememberPasskeyHere();
        // a full load, so the server reads the new session (and asks for the two-factor code when that is on)
        window.location.assign(next);
      }
    })();
    return () => { off = true; };
  }, [next]);
  return null;
}
