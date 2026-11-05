"use client";

import { useMemo } from "react";
import { createClient } from "@/lib/supabase/browser";
import { DecisionsView } from "./decisions-view";
import { SupabaseGateSource } from "./gate-source";

export function DecisionsClient({ tenantId, me, mayDecide }: { tenantId: string; me: string; mayDecide: boolean }) {
  const source = useMemo(() => new SupabaseGateSource(createClient(), tenantId), [tenantId]);
  return <DecisionsView source={source} me={me} mayDecide={mayDecide} />;
}
