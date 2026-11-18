// The November 2026 target sheet (Aryan, 18 Nov: "this is the latest; can it come out of the
// software in one click"), row for row as the company's Excel has it: head, channel, manager, the
// salesperson as the sheet names them, the Zoho name(s) their sales are invoiced under, HQ and the
// month's target in pesos. `person`: who that is in this ERP's org (full name), when they are in it;
// `area`: the seat by its area when the sheet's row is a vacant seat. Loaded by
// scripts/load-target-sheet.ts.

export type SheetRow = {
  head: string;
  channel: string;
  manager: string;
  salesperson: string;
  zoho: string[];
  hq: string;
  target: number;
  person?: string;
  area?: string;
};

const rx = (salesperson: string, zoho: string[], hq: string, target: number, person?: string): SheetRow => ({
  head: "Javed",
  channel: "RX Business",
  manager: "Honey",
  salesperson,
  zoho,
  hq,
  target,
  person,
});
const hos = (manager: string, salesperson: string, zoho: string[], hq: string, target: number, person?: string, area?: string): SheetRow => ({
  head: "Vanessa",
  channel: "HOSP",
  manager,
  salesperson,
  zoho,
  hq,
  target,
  person,
  area,
});

export const SHEET_2026_11: SheetRow[] = [
  rx("RX | GIENEL", ["RX | NCL"], "NCL", 2_053_269, "Gienel Carlos"),
  rx("RX | SEAN", ["RX | SL NORTH"], "SL NORTH", 1_076_802, "Kevin Sean Apid"),
  rx("RX | ALYSSA", ["RX | SL SOUTH"], "SL SOUTH", 500_000, "Allysa Mae Madera"),
  rx("RX | ANTONETTE", ["RX | CEBU NORTH"], "CEBU NORTH", 1_300_000, "Antonette Lawas"),
  rx("RX | JICE", ["RX | CEBU SOUTH"], "CEBU SOUTH", 500_000, "Jice Joyce Fajardo"),
  rx("RX | MERYANIE", ["RX | DAVAO"], "DAVAO", 800_000, "Meryanie Arcangel"),
  rx("RX | MARWIN", ["RX | TAFT"], "TAFT", 1_851_098, "Marwin Dy"),
  rx("RX | JOYCE", ["RX | EAST AVE"], "EAST AVE", 1_546_328, "Merry Joyce Sebastian"),
  // "Yza" is nobody by that name in the ERP's org yet: the sheet's figures, no person.
  rx("RX | YZA", ["RX | RODRIGUEZ", "RX | E. RODRIGUEZ"], "RODRIGUEZ", 823_030),
  rx("RX | ANGELICA", ["RX | KALAW"], "KALAW", 600_000, "Angelica Mae Saludes"),
  rx("RX | NOEL", ["RX | ORTIGAS/TMC", "RX | ORTIGAS / TMC"], "ORTIGAS/TMC", 600_000, "Noel Valencia"),
  { head: "Javed", channel: "MD Telesales", manager: "Honey", salesperson: "B2C | RACHELLE UPAO", zoho: ["B2C | Rachelle Upao"], hq: "ON SITE", target: 500_000, person: "Rachelle Upao" },
  { head: "Javed", channel: "MD Telesales", manager: "Honey", salesperson: "B2C | JANE", zoho: ["B2C | Mary Jane Vinas"], hq: "ON SITE", target: 500_000, person: "Mary Jane Viñas" },

  { head: "Subir", channel: "B2B", manager: "Jessa Domino", salesperson: "B2B | DHON", zoho: ["B2B | DHON"], hq: "ON SITE", target: 500_000 },
  { head: "Subir", channel: "B2B", manager: "Jessa Domino", salesperson: "B2B | FLOREMEL TAN MEDINA", zoho: ["B2B | FLOREMEL TAN MEDINA"], hq: "ON SITE", target: 1_415_319, person: "Floremel Medina" },
  { head: "Subir", channel: "B2B", manager: "Jessa Domino", salesperson: "B2B | FRITZIE ROSANN MIER", zoho: ["B2B | FRITZIE ROSANN MIER", "B2B | Fritzie Mier"], hq: "ON SITE", target: 6_016_856, person: "Fritzie Mier" },
  { head: "Subir", channel: "B2B", manager: "Jessa Domino", salesperson: "B2B | CLAIRE", zoho: ["B2B | CLAIRE"], hq: "ON SITE", target: 500_000 },
  { head: "Subir", channel: "B2B", manager: "Jessa Domino", salesperson: "B2B | LONIE", zoho: ["B2B | LONIE"], hq: "BAMBANG", target: 2_454_860, person: "Lonie Ann Neri" },
  { head: "Subir", channel: "B2B", manager: "Jessa Domino", salesperson: "B2B | PILLOW", zoho: ["B2B | PILLOW"], hq: "ON SITE", target: 2_350_771 },
  { head: "Subir", channel: "B2B", manager: "Jessa Domino", salesperson: "B2B | CHARLE", zoho: ["B2B | CHARLE"], hq: "ON SITE", target: 500_000 },
  { head: "Subir", channel: "B2B", manager: "Jessa Domino", salesperson: "B2B | MANI MISHRA", zoho: ["B2B | MANI MISHRA"], hq: "ON SITE", target: 0 },
  // The sheet has Faith twice: her own name, and Khayzee's (₱18,013 in November), which she sells now.
  { head: "Subir", channel: "B2B", manager: "Jessa Domino", salesperson: "B2B | FAITH", zoho: ["B2B | FAITH", "B2B | Winbelle Faith Gomez", "B2B | KHAYZEE"], hq: "ON SITE", target: 0, person: "Winbelle Faith Gomez" },
  { head: "Subir", channel: "BID", manager: "Subir", salesperson: "BID | HAZEL", zoho: ["BID | HAZEL"], hq: "ON SITE", target: 1_403_356, person: "Hazel Marie Balano" },
  { head: "Subir", channel: "BID", manager: "Subir", salesperson: "BID | ANGEL", zoho: ["BID | ANGEL"], hq: "ON SITE", target: 6_849_761, person: "Angelica Gollena" },
  { head: "Subir", channel: "BID", manager: "Subir", salesperson: "BID | JIMMY", zoho: ["BID | JIMMY"], hq: "ON SITE", target: 2_289_619, person: "Jimmy Boy Saturinas" },
  { head: "Subir", channel: "CLIDP", manager: "Subir", salesperson: "CLIDP | Annie Maglatang", zoho: ["CLIDP | Annie Maglatang"], hq: "FIELD SALES", target: 3_904_664, person: "Ma. Anicia D. Maglatang" },
  { head: "Subir", channel: "CLIDP", manager: "Subir", salesperson: "CLIDP | NICKA", zoho: ["CLIDP | NICKA"], hq: "FIELD SALES", target: 3_854_896, person: "Nicka Angelene Masusi" },

  { head: "Vanessa", channel: "TeleSales", manager: "Reynan", salesperson: "TeleSales | Micah", zoho: ["TeleSales | Micah", "TeleSales | Micah Jimena"], hq: "ON SITE", target: 300_000, person: "Micah Jimena" },
  { head: "Vanessa", channel: "TeleSales", manager: "Reynan", salesperson: "TeleSales | Seena", zoho: ["TeleSales | Seena", "TeleSales | Sheena Mae Correa"], hq: "ON SITE", target: 309_723, person: "Sheena Correa" },
  { head: "Vanessa", channel: "TeleSales", manager: "Reynan", salesperson: "TeleSales | AILA", zoho: ["TeleSales | AILA", "TeleSales | Aila Jane Zaragosa"], hq: "ON SITE", target: 300_000, person: "Aila Zaragoza" },
  { head: "Vanessa", channel: "TeleSales", manager: "Reynan", salesperson: "TeleSales | Mary Rose Goron", zoho: ["TeleSales | Mary Rose Goron"], hq: "ON SITE", target: 0, person: "Mary Rose Goron" },
  { head: "Vanessa", channel: "TeleSales", manager: "Reynan", salesperson: "TeleSales | Paula Bianca", zoho: ["TeleSales | Paula Bianca"], hq: "ON SITE", target: 0, person: "Paula Pentallana" },

  hos("Julius", "HOS | GABBY", ["HOS | BAGUIO"], "BAGIO", 675_872, "Gabrielle Agripa"),
  hos("Julius", "HOS | PABAZA VACANT", ["HOS | PAMPANGA"], "PAMPANGA", 500_000, undefined, "HOS | PAMPANGA"),
  hos("Julius", "HOS | PAOLO", ["HOS | CABANATUAN"], "CENTRAL LUZON", 541_077, "Paolo Paradero"),
  hos("Julius", "HOS | NICOLE", ["HOS | TUGUEGARAO"], "NORTH LUZON - 2", 300_000, "Nicole Anne Castillo"),
  hos("Daniel", "HOS | LJ", ["HOS | LJ", "HOS | LAS PINAS"], "LAS PINAS", 300_000, "Luis Jasper Palingping"),
  hos("Daniel", "HOSP | PATTRICK", ["HOS | PALAWAN"], "PALAWAN", 300_000, "Patrick Adion"),
  hos("Daniel", "HOS | KRIS", ["HOS | NORTH CEBU"], "NORTH CEBU", 500_000, "Kristofferson Conde"),
  hos("Daniel", "HOS | ANDY", ["HOS | SOUTH CEBU"], "SOUTH CEBU", 500_000, "Andrealyn Bermido"),
  hos("Daniel", "HOS | RYAN", ["HOS | PASAY"], "MANILA - 4", 600_000, "Ryan Aninon"),
  hos("Daniel", "HOS | ANA", ["HOS | PARANAQUE", "HOS | Ana Mae Otucan"], "PARANAQUE", 500_000, "Ana Mae Otucan"),
  hos("Claire", "HOS | MEL", ["HOS | CDO"], "CDO", 300_000, "Melanie Diaz"),
  hos("Claire", "HOS | VACANT", ["HOS | ZAMBOANGA"], "ZAMBOANGA", 300_000, undefined, "HOS | ZAMBOANGA"),
  hos("Claire", "HOSP | RUBY", ["HOS | DAVAO NORTH"], "DAVAO NORTH", 500_000, "Rubelyn Ramos"),
  hos("Claire", "HOS | WELMAR", ["HOS | DAVAO SOUTH"], "DAVAO SOUTH", 500_000, "Welmar Pancho"),
  hos("Claire", "HOSP | GENSAN CITY QUEEN", ["HOSP | GENSAN", "HOS | GENSAN"], "GENERAL SANTOS CITY", 300_000, "Harley Queen Orani"),
  hos("Ken", "HOS | CLARISSE", ["HOS | LAGUNA"], "LAGUNA", 925_217, "Clarisse Deocareza"),
  hos("Ken", "HOS | LALIEN", ["HOS | BICOL"], "BICOL AREA", 500_000, "Lalien G. Nunez"),
  hos("Ken", "HOS | MICHAEL", ["HOS | QUEZON PROVINCE"], "QC - 5", 500_000, "John Michael Orig"),
  hos("Ken", "HOS | GLENN", ["HOS | CAVITE"], "CAVITE", 300_000, "Glenn Bernabe"),
  hos("Jimlord", "HOS | PRINCESS", ["HOS | COMMONWEALTH"], "QC - 4", 899_648, "Princess Cuerdo"),
  hos("Jimlord", "HOS | JACOB", ["HOS | MARIKINA"], "MARIKINA", 300_000, "Jacob Cruz"),
  hos("Jimlord", "HOS | DEN JANE", ["HOS | CAMANAVA"], "CAMANAVA", 500_000, "Den Jane Suarez"),
  hos("Jimlord", "HOS | JESSA", ["HOS | ILOILO"], "ILOILO", 500_000, "Jessa Mae Teruel"),

  { head: "Mhalou", channel: "MT", manager: "Mhalou", salesperson: "MT | ARLENE", zoho: ["MT | 1"], hq: "ON SITE", target: 500_000 },
  { head: "Mhalou", channel: "MT", manager: "Mhalou", salesperson: "MT | JASPER", zoho: ["MT | 2"], hq: "ON SITE", target: 500_000 },
];
