// Rename and delete a project (issue #526): the words and the rules that do not need a database or a browser, so they are tested on their own.

/** The typed confirmation: the project's name, case and extra spaces ignored (the database checks the same). */
export const nameMatches = (typed: string, name: string) => typed.trim().replace(/\s+/g, " ").toLowerCase() === name.trim().replace(/\s+/g, " ").toLowerCase() && name.trim().length > 0;

/** A readable reason for a refusal of the database functions. */
export function projectErrorText(code: string | undefined | null, what: "rename" | "delete"): string {
  if (code === "42501") return `Only a workspace admin can ${what} a project.`;
  if (code === "23505") return "A project with that name already exists.";
  if (code === "22023") return what === "rename" ? "Give the project a name of 1 to 120 characters." : "The name you typed does not match the project, so nothing was deleted.";
  if (code === "PV011") return "Nothing was deleted: an initiative could not be deleted for good. Try again, or remove it from the Trash first.";
  return `The project could not be ${what === "rename" ? "renamed" : "deleted"}. Nothing was changed.`;
}

export type DeleteFacts = { name: string; live: number; trashed: number; tracker: "jira" | "github" | null };
/** What the confirmation says will go, in plain words with the exact counts. */
export function deleteWarning(f: DeleteFacts): { lines: string[]; total: number } {
  const total = f.live + f.trashed;
  const noun = (n: number) => `${n} initiative${n === 1 ? "" : "s"}`;
  const lines: string[] = [];
  if (total === 0) lines.push(`“${f.name}” has no initiatives. Only the project and its settings are deleted.`);
  else {
    if (f.live > 0) lines.push(`${noun(f.live)} in “${f.name}” ${f.live === 1 ? "goes" : "go"} to the Trash and ${f.live === 1 ? "is" : "are"} then deleted for good${f.trashed > 0 ? `, together with ${noun(f.trashed)} already in the Trash` : ""}.`);
    else lines.push(`${noun(f.trashed)} of “${f.name}” already in the Trash ${f.trashed === 1 ? "is" : "are"} deleted for good.`);
    lines.push("Everything that belongs to them is deleted too: documents, attachments and files, votes, comments, alignment results and their history.");
  }
  lines.push("The project's saved-scope membership, field configuration and tracker link are deleted too.");
  if (f.tracker) lines.push(`${f.tracker === "jira" ? "Jira" : "GitHub"} is not changed: its issues, labels and descriptions stay as they are.`);
  lines.push("This cannot be undone.");
  return { lines, total };
}
