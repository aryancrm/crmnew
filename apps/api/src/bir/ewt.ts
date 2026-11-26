// Philippine EWT, VAT split, local/foreign origin, and No-Withholding governance rules.
// Direct TypeScript port of proven NABHI_FINANCE/backend/modules/finance/payables.py (0.4.64).

import { Refusal } from "../http";

export type AtcDef = {
  code: string;
  description: string;
  rateBp: number;
  category: "ewt" | "vat_withholding" | "final";
  birForm: "1601-EQ" | "2550Q" | "1601-FQ";
};

/** Expanded Withholding Tax codes (RR 2-98 as amended by RR 11-2018 + Sir Mel Recording 19). */
export const WITHHOLDING: Record<string, [description: string, rateBp: number]> = {
  WC850: ["Direct pharma goods supplier / e-marketplace (0.5%)", 50],
  WC158: ["Goods, from a company (top withholding agent)", 100],
  WI158: ["Goods, from an individual (top withholding agent)", 100],
  WC160: ["Services, from a company (top withholding agent)", 200],
  WI160: ["Services, from an individual (top withholding agent)", 200],
  WC120: ["Contractors, companies", 200],
  WI120: ["Contractors, individuals", 200],
  WC100: ["Rent, to a company", 500],
  WI100: ["Rent, to an individual", 500],
  WI010: ["Professional fees, individual, gross up to ₱3M", 500],
  WI011: ["Professional fees, individual, gross over ₱3M", 1000],
  WC010: ["Professional fees, company, gross up to ₱720,000", 1000],
  WC011: ["Professional fees, company, gross over ₱720,000", 1500],
  WC140: ["Brokerage fees, company, gross over ₱720,000", 1500],
};

/** Customer-withheld ATCs supported in SAWT (split 1702Q CWT vs 2550Q 5% Gov't VAT). */
export const CWT_STATUTORY_BP: Record<string, number> = {
  WC850: 50,
  WC158: 100,
  WI158: 100,
  WC640: 100,
  WC160: 200,
  WI160: 200,
  WC157: 200,
  WC120: 200,
  WI120: 200,
  WV010: 500,
  WV020: 500,
  WC100: 500,
  WI100: 500,
  WI010: 500,
  WC010: 1000,
  WI011: 1000,
  WC011: 1500,
  WC140: 1500,
};

export const VAT_KINDS = {
  vat: "VAT 12%",
  zero: "Zero-rated",
  exempt: "VAT-exempt",
  none: "No VAT",
} as const;
export type VatKind = keyof typeof VAT_KINDS;

export const PURCHASE_TYPES = {
  services: "Services",
  capital_goods: "Capital goods",
  other_goods: "Other goods",
  importation: "Importation",
} as const;
export type PurchaseType = keyof typeof PURCHASE_TYPES;

export const ORIGINS = {
  local: "Local",
  foreign: "Foreign",
} as const;
export type SupplierOrigin = keyof typeof ORIGINS;

export const NO_WITHHOLDING = {
  foreign: "Foreign supplier",
  not_covered: "Payee not covered or exempt",
  government: "Government / statutory fee",
  exempt_charge: "Not qualified / exempt charge",
  other: "Other (see note)",
} as const;
export type NoWithholdingReason = keyof typeof NO_WITHHOLDING;

const FOREIGN_NAME = /\b(ltd|limited)\b/i;

/** Auto-detect local vs foreign origin from supplier name (user decision 2026-11-05). */
export function originByName(name: string | null | undefined): SupplierOrigin {
  return FOREIGN_NAME.test(name ?? "") ? "foreign" : "local";
}

/** Distinguish 5% Gov't Creditable VAT (`WV*` -> `2550Q`) from Income Tax CWT (`1702Q`). */
export function sawtFormForAtc(atc: string | null | undefined, explicit?: "1702Q" | "2550Q" | null): "1702Q" | "2550Q" {
  if (explicit === "1702Q" || explicit === "2550Q") return explicit;
  const clean = (atc ?? "").trim().toUpperCase();
  return clean.startsWith("WV") ? "2550Q" : "1702Q";
}

/** Validate a bill/expense line's withholding choice. */
export function withholdingDecision(
  origin: string | null | undefined,
  code: string | null | undefined,
  reason: string | null | undefined,
  note: string | null | undefined,
  complete: boolean,
): { code: string | null; reason: NoWithholdingReason | null; note: string | null } {
  const cleanNote = (note ?? "").trim() || null;
  const cleanCode = (code ?? "").trim().toUpperCase() || null;

  if (origin === "foreign") {
    if (cleanCode) {
      throw new Refusal(
        400,
        "invalid",
        "This is a foreign supplier: no tax is withheld from them. Clear the withholding code.",
        "atcCode",
      );
    }
    return { code: null, reason: "foreign", note: null };
  }

  if (cleanCode) {
    if (!(cleanCode in WITHHOLDING)) {
      throw new Refusal(400, "invalid", `Unknown withholding ATC code: ${cleanCode}.`, "atcCode");
    }
    return { code: cleanCode, reason: null, note: null };
  }

  if (!reason || reason === "foreign") {
    if (complete) {
      throw new Refusal(400, "invalid", "Pick a withholding code, or say why none is withheld.", "noWithholdingReason");
    }
    return { code: null, reason: null, note: cleanNote };
  }

  if (!(reason in NO_WITHHOLDING)) {
    throw new Refusal(400, "invalid", "Pick a valid no-withholding reason from the list.", "noWithholdingReason");
  }
  if (reason === "other" && !cleanNote) {
    throw new Refusal(400, "invalid", "Say why no tax is withheld in the note.", "noWithholdingNote");
  }
  return { code: null, reason: reason as NoWithholdingReason, note: cleanNote };
}

/** `bp` basis points of `amount` centavos, rounded to nearest centavo (half up). */
export function share(amountCentavos: number, bp: number): number {
  return Math.floor((amountCentavos * bp + 5_000) / 10_000);
}

export type PayableLineInput = {
  amountCentavos: number;
  vat: VatKind;
  withholding?: string | null;
  purchaseType?: PurchaseType;
};

export type WorkedPayableLine = PayableLineInput & {
  netCentavos: number;
  vatCentavos: number;
  withheldCentavos: number;
};

export type WorkedPayable = {
  lines: WorkedPayableLine[];
  netCentavos: number;
  vatCentavos: number;
  withheldCentavos: number;
  totalCentavos: number;
  payableCentavos: number;
  vatBp: number;
};

/** Compute net-of-VAT, VAT, and EWT per line and bill totals (matching NABHI_FINANCE/payables.py). */
export function workOutPayable(
  lines: PayableLineInput[],
  includeVat: boolean,
  vatBp = 1200,
): WorkedPayable {
  let net = 0;
  let vat = 0;
  let withheld = 0;
  const out: WorkedPayableLine[] = [];

  for (const line of lines) {
    const amount = Math.round(line.amountCentavos);
    let base = amount;
    let tax = 0;

    if (line.vat === "vat") {
      if (includeVat) {
        base = Math.floor((amount * 10_000 * 2 + (10_000 + vatBp)) / (2 * (10_000 + vatBp)));
        tax = amount - base;
      } else {
        base = amount;
        tax = share(amount, vatBp);
      }
    }

    const atc = line.withholding ? line.withholding.trim().toUpperCase() : null;
    if (atc && !(atc in WITHHOLDING)) {
      throw new Refusal(400, "invalid", `Unknown withholding ATC code: ${atc}.`, "atcCode");
    }
    const held = atc ? share(base, WITHHOLDING[atc]![1]) : 0;

    out.push({ ...line, netCentavos: base, vatCentavos: tax, withheldCentavos: held });
    net += base;
    vat += tax;
    withheld += held;
  }

  return {
    lines: out,
    netCentavos: net,
    vatCentavos: vat,
    withheldCentavos: withheld,
    totalCentavos: net + vat,
    payableCentavos: net + vat - withheld,
    vatBp,
  };
}
