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
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  medrep: "MedRep",
  team_lead: "Team lead",
  // A head (the chart's Mentor) and a team lead (Coach) do the same work; only how much of the
  // tree is theirs differs. The old "manager" role stays for the people who have it.
  manager: "Team lead",
  management: "Management",
  finance: "Finance",
  dispatch: "Dispatch",
  inventory: "Inventory",
  ceo: "CEO",
  online: "Online desk",
  admin: "Admin",
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
