import { notFound } from "next/navigation";
import { HarnessPhone } from "./harness";

/** Test page for the phone initiatives list with in-memory data. Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1. */
export default async function PhoneHarness({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  const q = await searchParams;
  return <HarnessPhone n={Number(q.n ?? 40)} />;
}
