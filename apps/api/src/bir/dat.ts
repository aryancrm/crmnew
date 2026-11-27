// BIR .DAT generators (RELIEF SLS/SLP, Alphalist QAP, split SAWT 1702Q/2550Q).
// Direct TypeScript port of NABHI_FINANCE/backend/modules/finance/bir_dat.py (0.4.64).
// Outputs are labeled as review drafts for verification in the official BIR RELIEF / Alphalist
// Validation Module before eSubmission.

import { Refusal } from "../http";

const FOLD: Record<string, string> = {
  "Ø": "O", "ø": "o", "Æ": "AE", "æ": "ae", "Œ": "OE", "œ": "oe",
  "ß": "ss", "Đ": "D", "đ": "d", "Þ": "TH", "þ": "th", "Ł": "L", "ł": "l",
};

export type DatTaxpayer = {
  tin?: string | null;
  branchCode?: string | null;
  registeredName?: string | null;
  tradeName?: string | null;
  address?: string | null;
  rdoCode?: string | null;
  fiscalMonthEnd?: number | null;
};

export function foldText(value: string | null | undefined): string {
  const raw = Array.from(String(value ?? ""), (ch) => FOLD[ch] ?? ch).join("");
  return raw.normalize("NFD").replace(/\p{Mn}/gu, "");
}

export function cleanText(value: string | null | undefined, width?: number): string {
  const s = foldText(value).toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s{2,}/g, " ").trim();
  return width ? s.slice(0, width).trim() : s;
}

export function cleanName(value: string | null | undefined): string {
  return foldText(value)
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[.-]/g, " ")
    .replace(/['\u2019,]/g, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function tin9(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "").slice(0, 9);
}

export function branch4(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return (digits.slice(-4) || "0000").padStart(4, "0");
}

export function splitAddr(address: string | null | undefined): [string, string] {
  const s = cleanText(address);
  if (!s) return ["", ""];
  if (s.length <= 30) return [s, ""];
  let cut = s.lastIndexOf(" ", 30);
  if (cut <= 0) cut = 30;
  return [s.slice(0, cut).trim(), cleanText(s.slice(cut).trim(), 30)];
}

export function amtH(centavos: number | null | undefined): string {
  return ((centavos ?? 0) / 100).toFixed(2);
}

export function amtD(centavos: number | null | undefined): string {
  const c = centavos ?? 0;
  return c === 0 ? "0" : (c / 100).toFixed(2);
}

const qq = (value: string) => `"${value}"`;

/** Format YYYY-MM-DD as MM/DD/YYYY (RELIEF) and MM/YYYY (Alphalist) and MMYYYY (filenames). */
function dateParts(isoEnd: string): { mmddyyyy: string; mmyyyy: string; compact: string } {
  const [y = "0000", m = "01", d = "01"] = isoEnd.split("-");
  return { mmddyyyy: `${m}/${d}/${y}`, mmyyyy: `${m}/${y}`, compact: `${m}${y}` };
}

function headerNames(taxpayer: DatTaxpayer) {
  const seller = tin9(taxpayer.tin) || "000000000";
  const reg = cleanText(taxpayer.registeredName || taxpayer.tradeName || "TAXPAYER");
  const trd = cleanText(taxpayer.tradeName || taxpayer.registeredName || "TAXPAYER");
  const [a1, a2] = splitAddr(taxpayer.address);
  const rdo = cleanText(taxpayer.rdoCode || "000");
  return { seller, reg, trd, a1, a2, rdo };
}

export type SlsData = {
  rows: {
    tin?: string | null;
    name: string;
    address?: string | null;
    exemptCentavos: number;
    zeroRatedCentavos: number;
    taxableCentavos: number;
    outputTaxCentavos: number;
  }[];
  totals: {
    exemptCentavos: number;
    zeroRatedCentavos: number;
    taxableCentavos: number;
    outputTaxCentavos: number;
  };
};

export function buildSlsDat(taxpayer: DatTaxpayer, periodEndIso: string, data: SlsData): { content: string; filename: string } {
  const { seller, reg, trd, a1, a2, rdo } = headerNames(taxpayer);
  const { mmddyyyy, compact } = dateParts(periodEndIso);
  const fy = String(Math.trunc(taxpayer.fiscalMonthEnd ?? 12));
  const t = data.totals;
  const lines = [
    [
      "H", "S", qq(seller), qq(reg), qq(""), qq(""), qq(""), qq(trd),
      qq(a1), qq(a2),
      amtH(t.exemptCentavos), amtH(t.zeroRatedCentavos), amtH(t.taxableCentavos), amtH(t.outputTaxCentavos),
      qq(rdo), mmddyyyy, fy,
    ].join(","),
  ];
  for (const r of data.rows) {
    const [ra1, ra2] = splitAddr(r.address);
    lines.push([
      "D", "S", qq(tin9(r.tin)), qq(cleanName(r.name)), qq(""), qq(""), qq(""),
      qq(ra1), qq(ra2),
      amtD(r.exemptCentavos), amtD(r.zeroRatedCentavos), amtD(r.taxableCentavos), amtD(r.outputTaxCentavos),
      seller, mmddyyyy,
    ].join(","));
  }
  return { content: `${lines.join("\r\n")}\r\n`, filename: `${seller}S${compact}.DAT` };
}

export type SlpData = {
  rows: {
    tin?: string | null;
    name: string;
    address?: string | null;
    exemptCentavos: number;
    zeroRatedCentavos: number;
    servicesCentavos: number;
    capitalGoodsCentavos: number;
    otherGoodsCentavos: number;
    inputTaxCentavos: number;
  }[];
  totals: {
    exemptCentavos: number;
    zeroRatedCentavos: number;
    servicesCentavos: number;
    capitalGoodsCentavos: number;
    otherGoodsCentavos: number;
    inputTaxCentavos: number;
  };
};

export function buildSlpDat(taxpayer: DatTaxpayer, periodEndIso: string, data: SlpData): { content: string; filename: string } {
  const { seller, reg, trd, a1, a2, rdo } = headerNames(taxpayer);
  const { mmddyyyy, compact } = dateParts(periodEndIso);
  const fy = String(Math.trunc(taxpayer.fiscalMonthEnd ?? 12));
  const t = data.totals;
  const lines = [
    [
      "H", "P", qq(seller), qq(reg), qq(""), qq(""), qq(""), qq(trd),
      qq(a1), qq(a2),
      amtH(t.exemptCentavos), amtH(t.zeroRatedCentavos), amtH(t.servicesCentavos),
      amtH(t.capitalGoodsCentavos), amtH(t.otherGoodsCentavos), amtH(t.inputTaxCentavos),
      amtH(0), qq(rdo), mmddyyyy, fy,
    ].join(","),
  ];
  for (const r of data.rows) {
    const [ra1, ra2] = splitAddr(r.address);
    lines.push([
      "D", "P", qq(tin9(r.tin)), qq(cleanName(r.name)), qq(""), qq(""), qq(""),
      qq(ra1), qq(ra2),
      amtD(r.exemptCentavos), amtD(r.zeroRatedCentavos), amtD(r.servicesCentavos),
      amtD(r.capitalGoodsCentavos), amtD(r.otherGoodsCentavos), amtD(r.inputTaxCentavos),
      seller, mmddyyyy,
    ].join(","));
  }
  return { content: `${lines.join("\r\n")}\r\n`, filename: `${seller}P${compact}.DAT` };
}

export type SawtData = {
  rows: {
    tin?: string | null;
    payor: string;
    atc: string;
    rateBp?: number | null;
    incomePaymentCentavos: number;
    withheldCentavos: number;
  }[];
  totals: {
    incomePaymentCentavos: number;
    withheldCentavos: number;
  };
};

export function buildSawtDat(
  taxpayer: DatTaxpayer,
  periodEndIso: string,
  data: SawtData,
  form: "1702Q" | "2550Q" = "1702Q",
): { content: string; filename: string } {
  const { seller, reg, rdo } = headerNames(taxpayer);
  const br = branch4(taxpayer.branchCode);
  const { mmyyyy, compact } = dateParts(periodEndIso);
  const t = data.totals;
  const lines = [
    ["HSAWT", `H${form}`, seller, br, qq(reg), qq(""), qq(""), qq(""), mmyyyy, rdo].join(","),
  ];
  data.rows.forEach((r, idx) => {
    const pt = tin9(r.tin);
    const pbr = branch4(null);
    const ratePct = ((r.rateBp ?? 0) / 100).toFixed(2);
    lines.push([
      "DSAWT", `D${form}`, String(idx + 1), pt, pbr, qq(cleanName(r.payor)), qq(""), qq(""), qq(""),
      mmyyyy, qq(""), cleanText(r.atc), ratePct,
      amtH(r.incomePaymentCentavos), amtH(r.withheldCentavos),
    ].join(","));
  });
  lines.push([
    "CSAWT", `C${form}`, seller, br, mmyyyy,
    amtH(t.incomePaymentCentavos), amtH(t.withheldCentavos),
  ].join(","));
  return { content: `${lines.join("\r\n")}\r\n`, filename: `${seller}${br}${compact}${form}.DAT` };
}

export type QapData = {
  rows: {
    tin?: string | null;
    payee: string;
    atc: string;
    rateBp?: number | null;
    baseCentavos: number;
    taxCentavos: number;
  }[];
  totals: {
    baseCentavos: number;
    taxCentavos: number;
  };
};

export function buildQapDat(taxpayer: DatTaxpayer, periodEndIso: string, data: QapData): { content: string; filename: string } {
  const { seller, reg, rdo } = headerNames(taxpayer);
  const br = branch4(taxpayer.branchCode);
  const { mmyyyy, compact } = dateParts(periodEndIso);
  const t = data.totals;
  const lines = [
    ["H1601EQ", seller, br, qq(reg), mmyyyy, rdo].join(","),
  ];
  data.rows.forEach((r, idx) => {
    const pt = tin9(r.tin);
    const pbr = branch4(null);
    const ratePct = ((r.rateBp ?? 0) / 100).toFixed(2);
    lines.push([
      "D1601EQ", String(idx + 1), pt, pbr, qq(cleanName(r.payee)), qq(""), qq(""), qq(""),
      mmyyyy, cleanText(r.atc), ratePct,
      amtH(r.baseCentavos), amtH(r.taxCentavos),
    ].join(","));
  });
  lines.push([
    "C1601EQ", seller, br, mmyyyy,
    amtH(t.baseCentavos), amtH(t.taxCentavos),
  ].join(","));
  return { content: `${lines.join("\r\n")}\r\n`, filename: `${seller}${br}${compact}1601EQ.DAT` };
}

export function buildListDat(
  which: "sls" | "slp" | "qap" | "sawt",
  taxpayer: DatTaxpayer,
  periodEndIso: string,
  data: SlsData | SlpData | QapData | SawtData,
  sawtForm: "1702Q" | "2550Q" = "1702Q",
): { content: string; filename: string } {
  if (which === "sls") return buildSlsDat(taxpayer, periodEndIso, data as SlsData);
  if (which === "slp") return buildSlpDat(taxpayer, periodEndIso, data as SlpData);
  if (which === "qap") return buildQapDat(taxpayer, periodEndIso, data as QapData);
  if (which === "sawt") return buildSawtDat(taxpayer, periodEndIso, data as SawtData, sawtForm);
  throw new Refusal(400, "invalid", `Unsupported DAT list: ${which}.`, "which");
}
