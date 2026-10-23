import { notFound } from "next/navigation";
import { HarnessTrash } from "./harness";

/** Test page for the Trash with in-memory data. Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1. */
export default async function TrashHarness({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  const q = await searchParams;
  return <HarnessTrash role={q.role ?? "admin"} />;
}
