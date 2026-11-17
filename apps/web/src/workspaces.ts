// The company portal's workspaces (Aryan, 18 Nov): the front door shows the company's departments;
// a person picks theirs and signs in with their own login ID and password as always. Only a look:
// who someone is and what they may do still come from their own login (their role, their seat),
// and the API checks every call as before.

import type { Me } from "@2mg/api/types";

export type Workspace = { key: string; label: string; about: string; roles: string[] };

export const WORKSPACES: Workspace[] = [
  { key: "sales", label: "Sales and field", about: "MedReps, team leads, heads", roles: ["medrep", "team_lead", "manager"] },
  { key: "management", label: "Management", about: "Order approvals, customers", roles: ["management"] },
  { key: "finance", label: "Finance", about: "Payments, invoices, the books", roles: ["finance"] },
  { key: "inventory", label: "Inventory", about: "Stock, purchasing", roles: ["inventory"] },
  { key: "dispatch", label: "Dispatch", about: "Packing and delivery", roles: ["dispatch"] },
  { key: "online", label: "Online desk", about: "Messenger, websites, cases", roles: ["online"] },
  { key: "hr", label: "HR", about: "People, attendance, payroll", roles: ["hr"] },
  { key: "regulatory", label: "Regulatory", about: "Registrations, complaints", roles: ["regulatory"] },
  { key: "office", label: "Office staff", about: "Work log", roles: ["staff"] },
  { key: "ceo", label: "CEO", about: "The whole company", roles: ["ceo"] },
  { key: "admin", label: "Administration", about: "Setup, logins, audit", roles: ["admin"] },
];

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
