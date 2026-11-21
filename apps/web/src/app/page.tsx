import { Home } from "./(marketing)/home";
import { homeMetadata } from "./(marketing)/seo";
import { getViewer } from "./(marketing)/viewer";

export const metadata = homeMetadata;

/**
 * The public website, for everyone (issues #570, #574). Being signed in no longer skips it: the header offers "Open app" (or "Back to the demo"
 * in the shared demo account) and the app itself starts at /app. The previous design stays at /classic.
 */
export default async function Root() {
  return <Home viewer={await getViewer()} />;
}
