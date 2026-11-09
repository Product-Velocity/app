import type { ConnectionRow } from "@/lib/github/server";

export const NOTICE: Record<string, string> = {
  started: "Checking GitHub in the background. This takes up to a minute; the result appears under the button and the page updates by itself.",
  waiting: "Request sent. An owner of the GitHub organisation must approve it; this page updates when GitHub confirms.",
  installed: "Installed on GitHub. Waiting for GitHub to confirm; this page updates when it does.",
  connected: "Connected.",
  disconnected: "Disconnected. The App stays installed on GitHub until an organisation owner uninstalls it.",
  refreshed: "Repositories refreshed.",
  "bad-link": "That link is no longer valid. Start the connection again.",
  "wrong-account": "GitHub was installed on a different account than the one you entered. Cancel and connect again with the right name.",
  "not-found": "GitHub did not recognise that installation. Try again.",
  "not-confirmed": "GitHub does not show this installation as active yet. If it is suspended, unsuspend it on GitHub; otherwise wait a minute and try again.",
  "already-linked": "That GitHub installation is already connected to another workspace.",
  "not-admin": "Only admins can connect GitHub.",
  retried: "Run again: it worked.",
  "retry-failed": "It still failed. The reason is in the sync log below.",
  "field-config-saved": "Field configuration saved. Nothing was written to GitHub; the next Sync uses it.",
  "field-config-invalid": "The field configuration was not saved.",
  error: "Something went wrong. Try again, or run the connection test.",
};

export const STATE: Record<ConnectionRow["state"], string> = {
  requested: "Started: finish the install on GitHub",
  waiting_approval: "Waiting for approval by a GitHub organisation owner",
  installing: "Installed: waiting for GitHub to confirm",
  connected: "Connected",
  suspended: "Suspended on GitHub",
  disconnected: "Not connected",
};

/** What to tell the admin when GitHub does not give an App the Projects of a personal account (issue #364 follow-up). */
export const PERSONAL_ACCOUNT_NOTE = "GitHub did not give the App this personal account\u2019s Projects. GitHub documents Project access for Apps on organisations only, so a board can be linked only if the Project belongs to a GitHub organisation where the App is installed. Issues, labels and Sync work as usual; to use a board, move the repository into a GitHub organisation and connect that.";

/** A hint on the Project boards card while the App is installed on a personal account (the Link button still tries, and shows GitHub\u2019s answer). */
export const PERSONAL_ACCOUNT_HINT = "Installed on a personal GitHub account: GitHub documents Project access for Apps on organisations only, so linking a board may not work here.";
