import { notFound } from "next/navigation";
import { SyncHarness } from "./harness";

/** Test page for the Sync with GitHub dialog with fake server calls. Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1. */
export default async function SyncTestPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  const q = await searchParams;
  return <SyncHarness scenario={q.scenario ?? "ok"} />;
}
