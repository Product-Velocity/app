"use client";

import { useMemo } from "react";
import { createClient } from "@/lib/supabase/browser";
import { GroupsAdmin } from "@/features/groups/groups-admin";
import { SupabaseGroupsStore } from "@/features/groups/store";

export function GroupsPanel({ tenantId, canAdmin }: { tenantId: string; canAdmin: boolean }) {
  const store = useMemo(() => new SupabaseGroupsStore(createClient(), tenantId), [tenantId]);
  return <GroupsAdmin store={store} canAdmin={canAdmin} />;
}
