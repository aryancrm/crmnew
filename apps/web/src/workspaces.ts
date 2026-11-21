// The company portal's workspaces (Aryan, 18 Nov): the front door shows the company's departments;
// a person picks theirs and signs in there. Which roles may sign in at each comes from the API's own
// list (@2mg/api/workspaces, Aryan 21 Nov: the token is the source of truth): a login is refused on
// a department it doesn't belong to, and the session keeps the department. Only the words and the
// grouping of the tiles are kept here.

import type { Me } from "@2mg/api/types";
import { WORKSPACE_ACCESS } from "@2mg/api/workspaces";

export type Workspace = { key: string; label: string; about: string; roles: string[]; group?: "selling" | "operations" | "office" };

const LOOK: Record<string, Pick<Workspace, "about" | "group">> = {
  sales: { group: "selling", about: "Visits, orders, your customers" },
  leads: { group: "selling", about: "Managers: your team's orders and figures" },
  heads: { group: "selling", about: "Your channels, managers and people" },
  management: { group: "operations", about: "Order approvals, customers" },
  finance: { group: "operations", about: "Payments, invoices, the books" },
  dispatch: { group: "operations", about: "Packing and delivery" },
  inventory: { group: "operations", about: "Stock, purchasing" },
  online: { group: "selling", about: "Messenger, websites, cases" },
  hr: { group: "office", about: "People, attendance, payroll" },
  regulatory: { group: "office", about: "Registrations, complaints" },
  office: { group: "office", about: "Work log" },
  ceo: { group: "office", about: "The whole company" },
  admin: { group: "office", about: "Setup, logins, audit" },
  books: { group: "office", about: "Accounts, banking, reports" },
};

// In the order line's order (Aryan, 19 Nov), as the API lists them.
export const WORKSPACES: Workspace[] = WORKSPACE_ACCESS.map((one) => ({
  key: one.key,
  label: one.label,
  roles: [...one.roles],
  about: LOOK[one.key]?.about ?? "",
  group: LOOK[one.key]?.group,
}));

/** The workspace a person's own login opens (their role decides, not the tile pressed). */
export const workspaceOf = (me: Pick<Me, "role">): Workspace =>
  WORKSPACES.find((one) => one.roles.includes(me.role)) ?? { key: "company", label: "Company", about: "", roles: [] };

const LAST = "crm:workspace";
export const lastWorkspace = (): string | null => {
  try {
    return localStorage.getItem(LAST);
  } catch {
    return null;
  }
};
export const rememberWorkspace = (key: string) => {
  try {
    localStorage.setItem(LAST, key);
  } catch {
    // A private window doesn't keep it.
  }
};
