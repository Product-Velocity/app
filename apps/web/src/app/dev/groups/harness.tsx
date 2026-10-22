"use client";

import { useEffect, useMemo } from "react";
import { GroupsAdmin } from "@/features/groups/groups-admin";
import { MemoryGroupsStore } from "@/features/groups/store";

export function HarnessGroups({ canAdmin }: { canAdmin: boolean }) {
  const store = useMemo(() => new MemoryGroupsStore([{ name: "Onboarding", items: 4 }, { name: "On-boarding", items: 2 }, { name: "Retention", items: 3 }, { name: "Unused idea" }]), []);
  useEffect(() => { (window as unknown as { __groups: unknown }).__groups = store; }, [store]);
  return (
    <div className="page-narrow">
      <h1>Initiative Groups</h1>
      <GroupsAdmin store={store} canAdmin={canAdmin} />
    </div>
  );
}
