/** How a linked tracker issue is written next to the Initiative ID: "#142" for GitHub, the key ("PROD-104") for Jira. */
export function trackerIssueLabel(url: string | null | undefined, number: number | null | undefined): string | null {
  if (url) {
    const jira = /\/browse\/([A-Z][A-Z0-9_]+-\d+)(?:[/?#]|$)/.exec(url);
    if (jira) return jira[1]!;
  }
  return number ? `#${number}` : null;
}

/** Only an https address may be opened from the app. */
export const isOpenableUrl = (url: string | null | undefined): url is string => !!url && /^https:\/\//i.test(url);
