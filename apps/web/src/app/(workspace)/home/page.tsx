import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";

export default async function HomePage() {
  const { active } = await requireWorkspace("/home");
  redirect(active.role === "leadership" ? "/leadership" : "/portfolio");
}
