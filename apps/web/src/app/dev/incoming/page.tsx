import { notFound } from "next/navigation";
import { IncomingHarness } from "./harness";

/** Test page for the Incoming list with in-memory data. Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1. */
export default async function IncomingTestPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  const q = await searchParams;
  return <IncomingHarness role={q.role ?? "admin"} />;
}
