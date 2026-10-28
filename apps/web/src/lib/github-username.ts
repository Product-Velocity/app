/** A GitHub username as GitHub allows it: letters, digits and single hyphens, not starting or ending with a hyphen, at most 39 characters. */
export const GITHUB_USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** What a person is told when saving a GitHub username did not work. `code` is the database error code. */
export function githubUsernameMessage(code: string | undefined): string {
  switch (code) {
    case "23505": return "Somebody else in this workspace already uses that GitHub username.";
    case "22023": return "That is not a GitHub username. Use letters, digits and single hyphens (at most 39 characters).";
    case "42501": return "You can set your own GitHub username; only an admin can set someone else's.";
    case "P0002": return "That person is not a member of this workspace.";
    default: return "We could not save the GitHub username. Please try again.";
  }
}

/** The text of the input as it will be saved: spaces and a leading @ removed; empty means "no username". */
export const cleanGithubUsername = (v: string) => v.trim().replace(/^@+/, "");
