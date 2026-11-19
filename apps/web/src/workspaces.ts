// The company portal's workspaces (Aryan, 18 Nov): the front door shows the company's departments;
// a person picks theirs and signs in with their own login ID and password as always. Only a look:
// who someone is and what they may do still come from their own login (their role, their seat),
// and the API checks every call as before.

import type { Me } from "@2mg/api/types";

export type Workspace = { key: string; label: string; about: string; roles: string[]; group?: "selling" | "operations" | "office" };

// In the order line's order (Aryan, 19 Nov): Sales and field, Management, Finance, Dispatch, then the rest.
export const WORKSPACES: Workspace[] = [
  // The sales line's three doors (Aryan, 19 Nov: "where do team leads sign in, where do heads?"),
  // as the sales tracker has it: the sales people, their managers, the heads of the channels.
  { key: "sales", group: "selling", label: "MedReps", about: "Visits, orders, your customers", roles: ["medrep"] },
  { key: "leads", group: "selling", label: "Team leads", about: "Managers: your team's orders and figures", roles: ["team_lead"] },
  { key: "heads", group: "selling", label: "Heads", about: "Your channels, managers and people", roles: ["manager"] },
  { key: "management", group: "operations", label: "Management", about: "Order approvals, customers", roles: ["management"] },
  { key: "finance", group: "operations", label: "Finance", about: "Payments, invoices, the books", roles: ["finance"] },
  { key: "dispatch", group: "operations", label: "Dispatch", about: "Packing and delivery", roles: ["dispatch"] },
  { key: "inventory", group: "operations", label: "Inventory", about: "Stock, purchasing", roles: ["inventory"] },
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
