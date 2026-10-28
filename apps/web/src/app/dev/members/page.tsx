import { notFound } from "next/navigation";
import { HarnessMembers } from "./harness";

/** Test page for the Workspace Members grid with in-memory data. Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1. */
export default async function MembersHarness({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  const q = await searchParams;
  return <HarnessMembers admin={q.role !== "viewer"} />;
}
