// The company portal's departments and who may sign in at each (Aryan, 21 Nov: "the token is the
// source of truth for access"). A sign-in names the department it was made on; it is refused when
// the login's role doesn't belong there, and the session keeps the department it was opened for.
// The web app's tiles read this same list (@2mg/api/workspaces), so the two can't drift apart.
// What a person may do on each call still comes from their role, checked by the API every time.

import type { Role } from "../people/roles";

export type WorkspaceKey =
  | "sales"
  | "leads"
  | "heads"
  | "management"
  | "finance"
  | "dispatch"
  | "inventory"
  | "online"
  | "hr"
  | "regulatory"
  | "office"
  | "ceo"
  | "admin"
  | "books";

export type WorkspaceAccess = { key: WorkspaceKey; label: string; roles: Role[] };

// In the order line's order (Aryan, 19 Nov). Books last, so a person's own department stays theirs.
export const WORKSPACE_ACCESS: WorkspaceAccess[] = [
  { key: "sales", label: "MedReps", roles: ["medrep"] },
  { key: "leads", label: "Team leads", roles: ["team_lead"] },
  { key: "heads", label: "Heads", roles: ["manager"] },
  { key: "management", label: "Management", roles: ["management"] },
  { key: "finance", label: "Finance", roles: ["finance"] },
  { key: "dispatch", label: "Dispatch", roles: ["dispatch"] },
  { key: "inventory", label: "Inventory", roles: ["inventory"] },
  { key: "online", label: "Online desk", roles: ["online"] },
  { key: "hr", label: "HR", roles: ["hr"] },
  { key: "regulatory", label: "Regulatory", roles: ["regulatory"] },
  { key: "office", label: "Office staff", roles: ["staff"] },
  { key: "ceo", label: "CEO", roles: ["ceo"] },
  { key: "admin", label: "Administration", roles: ["admin"] },
  { key: "books", label: "Books", roles: ["finance", "ceo", "admin"] },
];

export const WORKSPACE_KEYS = WORKSPACE_ACCESS.map((one) => one.key) as [WorkspaceKey, ...WorkspaceKey[]];

export const workspaceByKey = (key: string): WorkspaceAccess | undefined =>
  WORKSPACE_ACCESS.find((one) => one.key === key);

/** The department a role signs in at (its own; Books is only ever a second one). */
export const ownWorkspace = (role: Role): WorkspaceAccess | undefined =>
  WORKSPACE_ACCESS.find((one) => one.roles.includes(role));

export const workspaceAllows = (key: WorkspaceKey, role: Role): boolean =>
  workspaceByKey(key)?.roles.includes(role) ?? false;
