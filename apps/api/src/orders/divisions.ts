// What a field order carries as the hub's MedReps fill it in: the Division, the Sub-division and
// the Payment Terms agreed with the customer. Pure (no database), shared by the API and the web.
// The lists are the hub's own (getmeds-frontend src/constants/divisions.js and paymentTerms.js).

/** The Divisions, in the hub's order. */
export const DIVISIONS = [
  "B&B",
  "B2B",
  "B2C",
  "BID",
  "CLIDP",
  "HOS",
  "MSA",
  "STC",
  "TeleSales Anesthesia",
  "URO",
  "TeleSales",
  "MD Telesales",
  "PS",
  "MT",
] as const;

/** The named Sub-divisions of the four Divisions that have them: suggestions, never enforced. */
export const SUB_DIVISIONS: Record<string, string[]> = {
  "B&B": ["CEBU", "DAVAO", "E. RODRIGUEZ", "EAST AVE", "NCL", "SOUTH LUZON", "TAFT"],
  HOS: [
    "GENSAN",
    "PALAWAN",
    "BAGUIO",
    "BICOL",
    "CABANATUAN",
    "CAMANAVA",
    "CAVITE",
    "CDO",
    "COMMONWEALTH",
    "DAVAO NORTH",
    "DAVAO SOUTH",
    "ILOILO",
    "LAGUNA",
    "LAS PINAS",
    "MANILA VACANT",
    "MARIKINA",
    "NORTH CEBU",
    "PAMPANGA",
    "PARANAQUE",
    "PASAY",
    "QUEZON PROVINCE",
    "SOUTH CEBU",
    "TUGUEGARAO",
    "ZAMBOANGA",
  ],
  STC: ["CEBU", "COMMONWEALTH", "DAVAO", "KALAW", "NCL", "SOUTH LUZON", "TMC ORTIGAS"],
  URO: ["CEBU", "COMMONWEALTH", "DAVAO", "KALAW", "NCL", "SOUTH LUZON", "TMC ORTIGAS"],
};

/** The Payment Terms offered (Zoho's own list, PDC and NET first); any other can be typed. */
export const PAYMENT_TERMS = [
  "PDC 15",
  "PDC 30",
  "PDC 45",
  "PDC 60",
  "NET 15",
  "NET 30",
  "NET 45",
  "NET 60",
  "Due end of the month",
  "Due end of next month",
  "Advanced Payment",
  "Advanced Payment - Partial",
  "COD",
  "CASH",
  "Due on Receipt",
  "60% DP 40% UPON DEL",
  "30 days",
  "45 Day",
  "60 Day",
  "90 Day",
  "120 Day",
  "180 Day",
  "DSWD/PCSO",
  "OP",
  "INITIAL STOCKING",
  "Samples",
  "Donation/Charity",
];

/** The Division an order starts with: the MedRep's channel's (Management can change it). */
export function divisionOfChannel(code: string | null | undefined): string {
  switch (code) {
    case "HOSP":
      return "HOS";
    case "B2B":
    case "BID":
    case "MT":
      return code;
    case "TS":
      return "TeleSales";
    case "PAP":
      return "MD Telesales";
    case "ONLINE":
      return "B2C";
    default:
      return "";
  }
}

/** The Sub-division an area's name points at ("HOS | Pasay" -> "PASAY"), when it is a known one. */
export function subDivisionOfArea(division: string, area: string | null | undefined): string {
  const place = (area ?? "").split("|").pop()?.trim().toUpperCase() ?? "";
  return (SUB_DIVISIONS[division] ?? []).find((name) => name === place) ?? place;
}

/**
 * What the CRM's money rules make of a typed Payment Term: paid before it goes out, cash on
 * delivery, or so many days after the invoice. Anything with a number of days in it (PDC 30,
 * NET 45, 60 Day) is credit for those days; Advanced Payment, CASH and Due on Receipt are paid
 * first; COD and a down payment with the rest on delivery are cash on delivery; the month-end
 * terms are 30 and 60 days; the government's and the rest are 60 days.
 */
export function termsOfLabel(label: string): {
  terms: "advance" | "cod" | "days";
  days: number | null;
} {
  const text = label.trim().toLowerCase();
  const days = text.match(/(\d+)\s*(?:day|days)?\b/);
  if (/^(pdc|net)\b/.test(text) && days) return { terms: "days", days: Number(days[1]) };
  if (/\bday/.test(text) && days) return { terms: "days", days: Number(days[1]) };
  if (/advance|^cash$|due on receipt|bpo wallet|samples|donation|charity/.test(text))
    return { terms: "advance", days: null };
  if (/^cod$|upon del|on delivery/.test(text)) return { terms: "cod", days: null };
  if (/end of next month/.test(text)) return { terms: "days", days: 60 };
  if (/end of the month|^net$|initial stocking/.test(text)) return { terms: "days", days: 30 };
  return { terms: "days", days: 60 };
}

/** Where an order came from: the hub's Source list, asked on every order the field places. */
export const ORDER_SOURCES = [
  "Doctor order",
  "Patient order referred by doctor",
  "Patient order referred by patient",
  "Emergency purchase",
  "Hospital PO",
  "Distributor order",
  "Bidding Order",
  "B2C Order",
  "PCSO",
  "IAPF",
  "DSWD",
  "Office of the President",
  "Digital Marketing",
] as const;
