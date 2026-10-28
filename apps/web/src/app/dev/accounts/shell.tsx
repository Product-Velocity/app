"use client";

import { useMemo } from "react";
import { WorkspaceProvider } from "@/features/workspace/provider";
import { MemoryWorkspaceStore } from "@/features/workspace/store";
import { harnessLookups } from "../harness-data";

/** The header's project scope chip needs a workspace store; the test page gives it an in-memory one. */
export function HarnessShell({ children }: { children: React.ReactNode }) {
  const store = useMemo(() => Object.assign(new MemoryWorkspaceStore({ scopes: [] }), { projects: harnessLookups.projects }), []);
  return <WorkspaceProvider store={store} projects={harnessLookups.projects} canEdit canAdmin>{children}</WorkspaceProvider>;
}
