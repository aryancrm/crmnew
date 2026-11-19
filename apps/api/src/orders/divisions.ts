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

/** The Divisions a person's orders carry (Aryan, 19 Nov: a MedRep comes under one Division): their
 *  seats' own (the database's seat_division, migration 0114), the main seat's first, each once;
 *  with no seat, their channel's. */
export function divisionsOf(seats: (string | null)[] | null, channelDivision: string | null): string[] {
  const own = [...new Set((seats ?? []).filter((one): one is string => Boolean(one)))];
  return own.length ? own : channelDivision ? [channelDivision] : [];
}

/** Whom each Division's orders are usually for: the order form's customer list opens on these
 *  (every customer is one click away). Divisions not listed open on every customer. */
export const DIVISION_BUYERS: Record<string, string[]> = {
  HOS: ["hospital", "doctor"],
  "TeleSales Anesthesia": ["hospital", "doctor"],
  B2B: ["drugstore", "distributor"],
  CLIDP: ["distributor", "drugstore"],
  MT: ["drugstore", "distributor"],
  BID: ["government", "hospital"],
  B2C: ["patient", "doctor"],
  "B&B": ["patient", "doctor"],
  URO: ["patient", "doctor"],
  STC: ["patient", "doctor"],
  "MD Telesales": ["patient", "doctor"],
};

/** The named Sub-divisions of the Divisions that have them: suggestions, never enforced. B2B's
 *  two are its teams, as the hub has them (CRR keeps accounts buying, NBD finds new ones). */
export const SUB_DIVISIONS: Record<string, string[]> = {
  B2B: ["CRR", "NBD"],
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
export function subDivisionOfArea(
  division: string,
  area: string | null | undefined,
  title?: string | null,
): string {
  // B2B's are its two teams, never a place: the seat's own (an NBD's, a CRR's), else blank.
  if (division === "B2B") {
    const said = `${area ?? ""} ${title ?? ""}`;
    return /\bNBD\b/i.test(said) ? "NBD" : /\bCRR\b/i.test(said) ? "CRR" : "";
  }
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
  /** Paid by a particular date ("Pays by 2027-01-15"): its due day, whatever the invoice's. */
  payBy?: string | null;
} {
  const text = label.trim().toLowerCase();
  // Any particular date (Aryan, 18 Nov: "different dates"): due on that day.
  const by = text.match(/^pays by (\d{4}-\d{2}-\d{2})$/);
  if (by) {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
    const days = Math.max(0, Math.round((Date.parse(`${by[1]}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000));
    return { terms: "days", days, payBy: by[1] };
  }
  // Months, as said ("3 months"): thirty days each.
  const months = text.match(/(\d+)\s*months?\b/);
  if (months) return { terms: "days", days: Number(months[1]) * 30 };
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

/** An order's type, picked first on the order form (Aryan, 19 Nov: "pick it first, as the Online
 *  case's GL, PWD and Regular, and the whole order follows it"): whose order it is, and so which
 *  papers it carries. */
export const ORDER_TYPES = ["patient", "senior_pwd", "gl", "po", "no_po"] as const;
export type OrderTypeKey = (typeof ORDER_TYPES)[number];
export const ORDER_TYPE_LABEL: Record<OrderTypeKey, string> = {
  patient: "Patient",
  senior_pwd: "Senior / PWD",
  gl: "Guarantee letter",
  po: "With their PO",
  no_po: "No PO",
};
/** What each type asks for, in a few words. */
export const ORDER_TYPE_HINT: Record<OrderTypeKey, string> = {
  patient: "Prescription and the patient's ID",
  senior_pwd: "Prescription, ID and their senior or PWD ID: 20% off, no VAT",
  gl: "Prescription, ID and the guarantee letter: the agency pays",
  po: "Their purchase order: its number and the paper",
  no_po: "A business buying without a PO",
};
/** A patient's medicines (their own order, or one for a patient through a hospital or doctor). */
export const isPatientType = (type: string | null | undefined): boolean =>
  type === "patient" || type === "senior_pwd" || type === "gl";
/** The types in the order a Division's orders usually are: a patients' Division's first. */
export function orderTypesFor(division: string | null | undefined): OrderTypeKey[] {
  const buyers = (division && DIVISION_BUYERS[division]) || [];
  return buyers[0] === "patient"
    ? ["patient", "senior_pwd", "gl", "no_po", "po"]
    : ["po", "no_po", "patient", "senior_pwd", "gl"];
}

/** Whether the customer's purchase order (their PO to us, not ours to a supplier) comes with the
 *  order. Its type says so (19 Nov): "With their PO" needs it, a patient's own order never has
 *  one, any other business may give one. An order placed before types: needed when it came as a
 *  Hospital PO or a bidding order, never from a patient, else when they give one. A needed one
 *  missing shows on Management's Documents check, which decides; it never stops the order. */
export function poExpected(order: {
  type?: string | null;
  kind: string | null | undefined;
  source?: string | null;
}): "never" | "optional" | "expected" {
  if (order.type === "po") return "expected";
  if (!order.kind || order.kind === "patient") return "never";
  if (order.type) return "optional";
  return order.source === "Bidding Order" || order.source === "Hospital PO" ? "expected" : "optional";
}
