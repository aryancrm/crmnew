// The company portal's workspaces (Aryan, 18 Nov): the front door shows the company's departments;
// a person picks theirs and signs in with their own login ID and password as always. Only a look:
// who someone is and what they may do still come from their own login (their role, their seat),
// and the API checks every call as before.

import type { Me } from "@2mg/api/types";

export type Workspace = { key: string; label: string; about: string; roles: string[]; group?: "selling" | "operations" | "office" };

export const WORKSPACES: Workspace[] = [
  { key: "sales", group: "selling", label: "Sales and field", about: "MedReps, team leads, heads", roles: ["medrep", "team_lead", "manager"] },
  { key: "management", group: "operations", label: "Management", about: "Order approvals, customers", roles: ["management"] },
  { key: "finance", group: "operations", label: "Finance", about: "Payments, invoices, the books", roles: ["finance"] },
  { key: "inventory", group: "operations", label: "Inventory", about: "Stock, purchasing", roles: ["inventory"] },
  { key: "dispatch", group: "operations", label: "Dispatch", about: "Packing and delivery", roles: ["dispatch"] },
  { key: "online", group: "selling", label: "Online desk", about: "Messenger, websites, cases", roles: ["online"] },
  { key: "hr", group: "office", label: "HR", about: "People, attendance, payroll", roles: ["hr"] },
  { key: "regulatory", group: "office", label: "Regulatory", about: "Registrations, complaints", roles: ["regulatory"] },
  { key: "office", group: "office", label: "Office staff", about: "Work log", roles: ["staff"] },
  { key: "ceo", group: "office", label: "CEO", about: "The whole company", roles: ["ceo"] },
  { key: "admin", group: "office", label: "Administration", about: "Setup, logins, audit", roles: ["admin"] },
  // Its own app (docs/BOOKS-PLAN.md): opens Books Home. Last, so a person's own workspace stays theirs.
  { key: "books", group: "office", label: "Books", about: "Accounts, banking, reports", roles: ["finance", "ceo", "admin"] },
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
