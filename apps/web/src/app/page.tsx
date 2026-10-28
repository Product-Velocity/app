import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { lastLocationFromMetadata } from "@/lib/user-prefs";

export default async function Root() {
  const { active, user } = await requireWorkspace("/");
  // back to the screen and saved view the person was on in this account; leadership viewers otherwise start on their portfolio-level view
  const last = lastLocationFromMetadata(user.user_metadata, active.tenantId);
  redirect(last ?? (active.role === "leadership" ? "/leadership" : "/portfolio"));
}
