import { createClient } from "@/lib/supabase/server";
import { isDemoEmail } from "@/lib/demo-account";
import { Home } from "./(marketing)/home";
import { homeMetadata } from "./(marketing)/seo";

export const metadata = homeMetadata;

/**
 * The public website, for everyone (issue #570). Being signed in no longer skips it: the header offers "Open app" (or "Back to the demo"
 * in the shared demo account) and the app itself starts at /app.
 */
export default async function Root() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const viewer = data.user ? (isDemoEmail(data.user.email) ? "demo" : "member") : null;
  return <Home viewer={viewer} />;
}
