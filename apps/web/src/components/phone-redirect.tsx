"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useIsPhone } from "@/features/phone/use-is-phone";

/** On a phone, a screen made for a big display sends the person to the phone screen that does the same job (issue #635), never to a dead end. */
export function PhoneRedirect({ to }: { to: string }) {
  const phone = useIsPhone();
  const router = useRouter();
  useEffect(() => { if (phone) router.replace(to); }, [phone, router, to]);
  return null;
}
