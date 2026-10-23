"use client";

import { useMemo } from "react";
import { createClient } from "@/lib/supabase/browser";
import { IncomingView } from "./incoming-view";
import { SupabaseIncomingSource } from "./supabase-source";

export function IncomingClient({ tenantId, projects, canEdit, canAdmin }: { tenantId: string; projects: { id: string; name: string }[]; canEdit: boolean; canAdmin: boolean }) {
  const source = useMemo(() => new SupabaseIncomingSource(createClient(), tenantId), [tenantId]);
  return <IncomingView source={source} projects={projects} canEdit={canEdit} canAdmin={canAdmin} />;
}
