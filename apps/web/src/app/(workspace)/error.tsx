"use client";

import { LoadError } from "@/components/load-error";

/** A page of the workspace that fails to load (after a release, or a login refresh that raced another request) is loaded again once, then explained. */
export default function WorkspaceError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <LoadError {...props} />;
}
