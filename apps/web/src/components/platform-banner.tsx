import { leavePlatformAccount } from "@/app/platform/actions";
import type { PlatformAccess } from "@/lib/session";

/** FR-2.3: always visible while a platform admin is inside a customer account. */
export function PlatformBanner({ platform, accountName }: { platform: PlatformAccess; accountName: string }) {
  const readOnly = platform.level === "read_only";
  return (
    <div className={readOnly ? "platform-banner platform-banner-ro" : "platform-banner"} role="status" data-testid="platform-banner">
      <span>
        Viewing as platform admin &ndash; <strong>{platform.adminName}</strong> ({platform.adminEmail}) &ndash; <strong>{accountName}</strong>
      </span>
      <span className="platform-level" data-testid="platform-level">{readOnly ? "Read-only access" : "Read & write access"}</span>
      <form action={leavePlatformAccount}>
        <button className="btn" type="submit">Leave account</button>
      </form>
    </div>
  );
}
