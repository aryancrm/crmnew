// The roles. A person has exactly one; it decides their screens and what the API lets them do.

export const ROLES = [
  "medrep",
  "team_lead",
  "manager",
  "management",
  "finance",
  "dispatch",
  "inventory",
  "ceo",
  "online",
  "admin",
  "hr",
  // Office departments that neither sell nor run the order line (Digital Marketing, IT…).
  "staff",
  // In-licensing & Regulatory: the product pipeline and the FDA registrations (CPRs).
  "regulatory",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  medrep: "MedRep",
  team_lead: "Team lead",
  // A head of the sales tracker (the chart's Mentor: Javed, Subir, Vanessa, Mhalou), named as the
  // tracker and the sign-in page's Heads door name them (19 Nov).
  manager: "Head",
  management: "Management",
  finance: "Finance",
  dispatch: "Dispatch",
  inventory: "Inventory",
  ceo: "CEO",
  online: "Online desk",
  admin: "Admin",
  hr: "HR",
  staff: "Office staff",
  regulatory: "In-licensing & Regulatory",
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
