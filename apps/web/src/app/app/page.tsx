import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { lastLocationFromMetadata } from "@/lib/user-prefs";

export const metadata = { title: "Product Velocity", robots: { index: false, follow: false } };

/**
 * The way into the app (issue #570). The public website lives at `/` for everyone, signed in or not; this is where signed-in people go:
 * back to the screen and saved view they were on in this account, and leadership viewers otherwise start on their portfolio-level view.
 * Signed-out visitors are sent to sign in and come back here.
 */
export default async function OpenApp() {
  const { active, user } = await requireWorkspace("/app");
  const last = lastLocationFromMetadata(user.user_metadata, active.tenantId);
  redirect(last ?? (active.role === "leadership" ? "/leadership" : "/portfolio"));
}
