"use client";

import { useMemo } from "react";
import { createClient } from "@/lib/supabase/browser";
import { DecisionsView } from "./decisions-view";
import { SupabaseGateSource } from "./gate-source";
import { useIsPhone } from "../phone/use-is-phone";
import { PhoneDecisions } from "../phone/phone-decisions";

export function DecisionsClient({ tenantId, me, mayDecide }: { tenantId: string; me: string; mayDecide: boolean }) {
  const source = useMemo(() => new SupabaseGateSource(createClient(), tenantId), [tenantId]);
  const phone = useIsPhone();
  if (phone) return <PhoneDecisions source={source} me={me} mayDecide={mayDecide} tenantId={tenantId} />;
  return <DecisionsView source={source} me={me} mayDecide={mayDecide} />;
}
