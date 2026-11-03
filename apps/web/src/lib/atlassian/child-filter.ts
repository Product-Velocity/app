// The children of a linked initiative are part of its tree, not new items (issue #67, #71): every list and count of Jira issues that nobody
// has decided on leaves out `child_of_item is not null`. The column arrives with migration jira_sub_items, which is applied by hand: until it
// is, the query without the filter runs instead, so a missing column never makes the whole list look empty.
type Answer<T> = { data: T; error: { message: string; code?: string } | null; count?: number | null };

export const missingChildColumn = (e: { message: string; code?: string } | null): boolean => !!e && (e.code === "42703" || /child_of_item/.test(e.message));

/** Runs `run(true)` (with the filter); when the database has no such column yet, runs `run(false)` (without it). */
export async function leavingChildrenOut<T>(run: (leaveOut: boolean) => PromiseLike<Answer<T>>): Promise<Answer<T>> {
  const first = await run(true);
  return missingChildColumn(first.error) ? run(false) : first;
}
