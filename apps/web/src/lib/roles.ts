export const ROLES = ["viewer", "commenter", "creator", "admin", "leadership"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  viewer: "Viewer",
  commenter: "Commenter",
  creator: "Creator",
  admin: "Admin",
  leadership: "Leadership viewer",
};

export const ROLE_HELP: Record<Role, string> = {
  viewer: "Can read",
  commenter: "Can read and comment",
  creator: "Can create and edit items",
  admin: "Manages people and settings",
  leadership: "Portfolio-level read",
};

export function parseRole(value: unknown): Role | null {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value)
    ? (value as Role)
    : null;
}
