"use client";

import { LoadError } from "@/components/load-error";

/** The last net: an error above the workspace layout (the layout itself failed). Same one automatic reload, then Reload and Back. */
export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <LoadError {...props} />
      </body>
    </html>
  );
}
