import { notFound } from "next/navigation";
import { HarnessGroups } from "./harness";

/** Test page for the Initiative Group tidy-up with in-memory data. Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1. */
export default async function GroupsHarness({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  const q = await searchParams;
  return <HarnessGroups canAdmin={q.role !== "creator"} />;
}
