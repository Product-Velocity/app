import { notFound } from "next/navigation";
import { HarnessNotifications } from "./harness";

/** Test page for the notifications bell with in-memory data. Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1. */
export default async function NotificationsHarness({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  const q = await searchParams;
  return <HarnessNotifications empty={q.empty === "1"} />;
}
