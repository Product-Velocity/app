import { notFound } from "next/navigation";
import { HarnessPeople } from "./harness";

/** Test page for "Not invited yet" on the Members screen, with in-memory data. Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1. */
export default function PeopleHarness() {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  return <HarnessPeople />;
}
