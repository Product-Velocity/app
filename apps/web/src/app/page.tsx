import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";

export default async function Root() {
  await requireWorkspace("/");
  redirect("/home");
}
