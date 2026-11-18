import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { lastLocationFromMetadata } from "@/lib/user-prefs";
import { Home } from "./(marketing)/home";
import { homeMetadata } from "./(marketing)/seo";

export const metadata = homeMetadata;

/** Signed-out visitors see the public homepage (issue #498); people who are signed in go straight into the app. */
export default async function Root() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return <Home />;
  const { active, user } = await requireWorkspace("/");
  // back to the screen and saved view the person was on in this account; leadership viewers otherwise start on their portfolio-level view
  const last = lastLocationFromMetadata(user.user_metadata, active.tenantId);
  redirect(last ?? (active.role === "leadership" ? "/leadership" : "/portfolio"));
}
