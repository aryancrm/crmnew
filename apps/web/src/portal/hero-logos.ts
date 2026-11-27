/** Each workspace's logo, as on the portal's first screen: public/system-logos/web, small copies of
 *  public/system-logos. The order is the hero's, row by row. Also used by the home page's
 *  "Every department, one connected platform" section. */
export const HERO_LOGOS: Record<string, string> = {
  sales: "medreps",
  leads: "teamleads",
  heads: "heads",
  management: "management",
  finance: "finance",
  dispatch: "dispatch",
  inventory: "inventory",
  online: "onlinedesk",
  hr: "hr",
  regulatory: "regulatory",
  office: "officestaff",
  ceo: "ceo",
  admin: "administration",
  books: "books",
  marketing: "digitalmarketing",
  workdrive: "workdrive",
};

/** The address of a workspace's logo. */
export const heroLogo = (key: string) => `/system-logos/web/${HERO_LOGOS[key] ?? key}.webp`;
