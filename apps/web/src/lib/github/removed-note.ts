// Words only (no GitHub call): what the Sync preview says about an initiative that was removed, whose issue Product Velocity closed, and that was restored since.

/** Said in the Sync preview of an initiative that was removed, whose issue Product Velocity closed, and that was restored since: the issue is not reopened. `result` is item_github_links.removed_result. */
export function restoredAfterCloseNote(issue: string, result: string | null | undefined): string | null {
  if (!result || result === "not_found") return null;
  return `This initiative was removed earlier, so its GitHub issue ${issue} was labelled “pv:removed”${result === "closed" || result === "already_done" ? " and is closed" : ""}. Product Velocity does not reopen it: reopen it in GitHub if the work continues.`;
}
