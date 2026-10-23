"use client";

import { useMemo } from "react";
import { createClient } from "@/lib/supabase/browser";
import { SupabaseDataSource } from "../portfolio/supabase-source";
import type { Lookups } from "../portfolio/types";
import { TrashView } from "./trash-view";

export function TrashClient({ tenantId, role, lookups }: { tenantId: string; role: string; lookups: Lookups }) {
  const source = useMemo(() => new SupabaseDataSource(createClient(), tenantId, createClient("import")), [tenantId]);
  return <TrashView source={source} lookups={lookups} role={role} />;
}
