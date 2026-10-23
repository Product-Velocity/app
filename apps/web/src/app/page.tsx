import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";

export default async function Root() {
  const { active } = await requireWorkspace("/");
  redirect(active.role === "leadership" ? "/leadership" : "/portfolio"); // leadership viewers start on their portfolio-level view
}
