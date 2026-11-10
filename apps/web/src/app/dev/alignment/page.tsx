import { notFound } from "next/navigation";
import { HarnessAlignment } from "./harness";

/** Test page for the Alignment tab with in-memory sessions (fictional). Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1. */
export default async function AlignmentHarness({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  const q = await searchParams;
  return <HarnessAlignment role={q.role === "member" ? "member" : "admin"} empty={q.empty === "1"} />;
}
