/**
 * Roles and the user shape the control panel works with. Kept free of
 * server-only imports so the React bundle can share it.
 */
export type Role = "admin" | "editor";

export const ROLES: { value: Role; label: string; description: string }[] = [
  {
    value: "editor",
    label: "Editor",
    description: "Can create, edit and publish content and upload assets.",
  },
  {
    value: "admin",
    label: "Admin",
    description: "Everything an editor can do, plus manage users.",
  },
];

export function isRole(value: unknown): value is Role {
  return value === "admin" || value === "editor";
}

/** What the API sends to the browser about a user. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** `invited` until the first successful sign-in. */
  status: "invited" | "active";
  /** `config` for addresses listed in `auth.admins`; they cannot be removed or demoted. */
  origin: "config" | "invite";
  createdAt: string;
  lastLoginAt?: string;
}
