// Official-background BIR draft PDF generators using pdf-lib + verified BIR blank templates
// in apps/api/assets/bir/ (SHA-256 checksum guarded, matching NABHI_FINANCE 0.4.65).
//
// Outputs are strictly DRAFT / REVIEW ONLY (never electronically filed or signed).

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import { Refusal } from "../http";
import { foldText } from "./dat";

const ASSETS_DIR = fileURLToPath(new URL("../../assets/bir", import.meta.url));
const RED = rgb(0.608, 0.145, 0.145);
const BLACK = rgb(0, 0, 0);
const SLATE = rgb(0.29, 0.33, 0.41);
const HEADER_BG = rgb(0.902, 0.933, 0.953);
const BORDER = rgb(0.79, 0.83, 0.86);

type Fonts = {
  regular: PDFFont;
  bold: PDFFont;
  monoBold: PDFFont;
};

async function loadFonts(doc: PDFDocument): Promise<Fonts> {
  const [regular, bold, monoBold] = await Promise.all([
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaBold),
    doc.embedFont(StandardFonts.CourierBold),
  ]);
  return { regular, bold, monoBold };
}

/** Standard PDF fonts are WinAnsi only; replace Peso sign and fold diacritics cleanly. */
function pdfSafe(value: string | null | undefined): string {
  return foldText(String(value ?? "").replaceAll("\u20b1", "PHP ")).replace(/[^\x20-\x7e]/g, " ");
}

function formatPhp(centavos: number): string {
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.abs(Math.round(centavos));
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${sign}${whole.toLocaleString("en-US")}.${String(cents).padStart(2, "0")}`;
}

export function roundPesoHalfUp(centavos: number): number {
  const v = Math.round(centavos);
  const sign = v < 0 ? -1 : 1;
  const abs = Math.abs(v);
  let whole = Math.floor(abs / 100);
  if (abs % 100 >= 50) whole += 1;
  return sign * whole;
}

async function loadVerifiedTemplate(stem: string): Promise<PDFDocument> {
  const [pdfBytes, provText] = await Promise.all([
    readFile(`${ASSETS_DIR}/${stem}.pdf`),
    readFile(`${ASSETS_DIR}/${stem}.source.json`, "utf8"),
  ]);
  const provenance = JSON.parse(provText) as { sha256: string };
  const digest = createHash("sha256").update(pdfBytes).digest("hex");
  if (digest !== provenance.sha256) {
    throw new Error(`Official BIR template checksum mismatch for ${stem}.`);
  }
  return PDFDocument.load(pdfBytes);
}

function fitText(
  page: PDFPage,
  font: PDFFont,
  text: string | null | undefined,
  x: number,
  y: number,
  maxWidth: number,
  startSize = 9,
  minSize = 5.5,
  color = BLACK,
): void {
  const s = pdfSafe(text).toUpperCase().trim();
  if (!s) return;
  let size = startSize;
  while (size > minSize && font.widthOfTextAtSize(s, size) > maxWidth) size -= 0.25;
  page.drawText(s, { x, y, size: Math.max(size, minSize), font, color });
}

function drawCentered(page: PDFPage, font: PDFFont, text: string, centerX: number, y: number, size = 9, color = BLACK): void {
  const s = pdfSafe(text);
  const w = font.widthOfTextAtSize(s, size);
  page.drawText(s, { x: centerX - w / 2, y, size, font, color });
}

function drawRight(page: PDFPage, font: PDFFont, text: string, rightX: number, y: number, size = 8, color = BLACK): void {
  const s = pdfSafe(text);
  const w = font.widthOfTextAtSize(s, size);
  page.drawText(s, { x: rightX - w, y, size, font, color });
}

function drawBoxes(page: PDFPage, font: PDFFont, text: string, centres: number[], y: number, size = 9): void {
  const chars = pdfSafe(text).split("");
  for (let i = 0; i < centres.length && i < chars.length; i++) {
    drawCentered(page, font, chars[i]!, centres[i]!, y, size);
  }
}

function normalizeTinBranch(tin: string | null | undefined, branchCode: string | null | undefined) {
  const digits = String(tin ?? "").replace(/\D/g, "");
  const tin9 = digits.slice(0, 9);
  const branch = (branchCode ?? (digits.length === 14 ? digits.slice(9) : "00000")).replace(/\D/g, "").padStart(5, "0").slice(0, 5);
  return { tin9, branch };
}

function normalizeRdo(rdo: string | null | undefined): string {
  return String(rdo ?? "").trim().toUpperCase().replace(/^0(\d{2}[0-9A-Z])$/, "$1").slice(0, 3);
}

// ------------------------------------------------------------------ 1702Q Official ENCS (Jan 2018)

export async function render1702qPdf(report: {
  quarter: number;
  year: number;
  rateBp: number;
  taxpayer: { registeredName?: string | null; tin?: string | null; branchCode?: string | null; rdoCode?: string | null; address?: string | null };
  totals: {
    grossSalesCentavos: number;
    costOfSalesCentavos: number;
    grossIncomeCentavos: number;
    operatingExpensesCentavos: number;
    taxableIncomeCentavos: number;
    rcitCentavos: number;
    mcitCentavos: number;
    taxDueCentavos: number;
    cwtCreditsCentavos: number;
    netPayableCentavos: number;
  };
}): Promise<Uint8Array> {
  if (![1, 2, 3].includes(report.quarter)) {
    throw new Refusal(400, "invalid", "BIR Form 1702Q covers Q1, Q2, and Q3 only; Q4 is filed on 1702-RT.");
  }
  const doc = await loadVerifiedTemplate("1702q-2018-01");
  const fonts = await loadFonts(doc);
  const pages = doc.getPages();
  const p1 = pages[0]!;
  const p2 = pages[1]!;
  const h1 = p1.getHeight();
  const h2 = p2.getHeight();

  const { tin9 } = normalizeTinBranch(report.taxpayer.tin, report.taxpayer.branchCode);
  const rdo = normalizeRdo(report.taxpayer.rdoCode);
  const year = String(report.year);
  const ratePct = String(Math.round(report.rateBp / 100));

  const pesoBoxes = (page: PDFPage, h: number, centavos: number, top: number, lastX = 584.5, step = 14.15) => {
    const whole = roundPesoHalfUp(centavos);
    const digits = `${whole < 0 ? "-" : ""}${Math.abs(whole)}`;
    const rev = digits.split("").reverse();
    for (let i = 0; i < rev.length && i < 12; i++) {
      drawCentered(page, fonts.monoBold, rev[i]!, lastX - step * i, h - top, 8.5);
    }
  };

  // Page 1 header
  drawCentered(p1, fonts.bold, "X", 59.5, h1 - 136.0, 9.5);
  drawBoxes(p1, fonts.monoBold, "12", [34.5, 49.5], h1 - 161.5, 9);
  drawBoxes(p1, fonts.monoBold, year.slice(-2), [99.5, 114.5], h1 - 161.5, 9);
  drawCentered(p1, fonts.bold, "X", [161.5, 190.5, 219.5][report.quarter - 1]!, h1 - 149.0, 9.5);
  if (tin9.length === 9) {
    const tinCentres = [218.0, 278.5, 339.0].flatMap((g) => [0, 1, 2].map((i) => g + i * 15.15));
    drawBoxes(p1, fonts.monoBold, tin9, tinCentres, h1 - 192.0, 9);
  }
  drawBoxes(p1, fonts.monoBold, rdo, [542.5, 557.5, 572.5], h1 - 192.0, 9);
  fitText(p1, fonts.regular, report.taxpayer.registeredName, 24.0, h1 - 223.0, 560.0, 9);
  fitText(p1, fonts.regular, report.taxpayer.address, 24.0, h1 - 271.0, 560.0, 8);
  drawCentered(p1, fonts.bold, "X", 149.0, h1 - 337.5, 9.5);

  const t = report.totals;
  pesoBoxes(p1, h1, t.taxDueCentavos, 390.5);
  pesoBoxes(p1, h1, t.taxDueCentavos, 429.5);
  pesoBoxes(p1, h1, t.taxDueCentavos, 468.0);
  pesoBoxes(p1, h1, t.cwtCreditsCentavos, 487.0);
  pesoBoxes(p1, h1, t.netPayableCentavos, 506.5);
  pesoBoxes(p1, h1, t.netPayableCentavos, 603.0);
  drawCentered(p1, fonts.bold, "DRAFT / REVIEW ONLY - NOT FOR FILING - ACTUAL PAYMENTS NOT VERIFIED", 306, h1 - 10, 8, RED);

  // Page 2 Schedules 2, 3, 4
  if (tin9.length === 9) {
    const p2Tin = [24.0, 74.5, 125.0].flatMap((g) => [0, 1, 2].map((i) => g + i * 13.5));
    drawBoxes(p2, fonts.monoBold, tin9, p2Tin, h2 - 104.0, 8.5);
  }
  fitText(p2, fonts.regular, report.taxpayer.registeredName, 236.0, h2 - 104.0, 345.0, 8.5);

  pesoBoxes(p2, h2, t.grossSalesCentavos, 390.5);
  pesoBoxes(p2, h2, t.costOfSalesCentavos, 407.6);
  pesoBoxes(p2, h2, t.grossIncomeCentavos, 424.7);
  pesoBoxes(p2, h2, t.grossIncomeCentavos, 459.0);
  pesoBoxes(p2, h2, t.operatingExpensesCentavos, 476.0);
  pesoBoxes(p2, h2, t.taxableIncomeCentavos, 493.1);
  pesoBoxes(p2, h2, t.taxableIncomeCentavos, 527.3);
  drawBoxes(p2, fonts.monoBold, ratePct, [559.5, 573.5], h2 - 544.5, 8.5);
  pesoBoxes(p2, h2, t.rcitCentavos, 561.5);
  pesoBoxes(p2, h2, t.mcitCentavos, 578.6);
  pesoBoxes(p2, h2, t.taxDueCentavos, 595.7);

  const qTops = [630.0, 647.1, 664.2];
  pesoBoxes(p2, h2, Math.max(0, t.grossIncomeCentavos), qTops[report.quarter - 1]!);
  pesoBoxes(p2, h2, Math.max(0, t.grossIncomeCentavos), 681.3);
  pesoBoxes(p2, h2, t.mcitCentavos, 717.0);

  pesoBoxes(p2, h2, t.cwtCreditsCentavos, 820.0);
  pesoBoxes(p2, h2, t.cwtCreditsCentavos, 891.5);
  drawCentered(p2, fonts.bold, "DRAFT / REVIEW ONLY - NOT FOR FILING - ACTUAL PAYMENTS NOT VERIFIED", 306, h2 - 10, 8, RED);

  doc.setTitle("1702Q review draft - not for filing");
  return doc.save();
}

// ------------------------------------------------------------------ 0619-E, 1601-EQ (+ Continuation), 1604-E

export async function renderWithholdingPdf(
  report:
    | {
        form: "0619E";
        period: { start: string; end: string; label: string };
        taxpayer: { registeredName?: string | null; tin?: string | null; branchCode?: string | null; rdoCode?: string | null; address?: string | null };
        rows: { atc: string; nature: string; rateBp: number; baseCentavos: number; taxCentavos: number }[];
        totalCentavos: number;
      }
    | {
        form: "1601EQ";
        year: number;
        quarter: number;
        period: { start: string; end: string; label: string };
        taxpayer: { registeredName?: string | null; tin?: string | null; branchCode?: string | null; rdoCode?: string | null; address?: string | null };
        rows: { atc: string; nature: string; rateBp: number; baseCentavos: number; taxCentavos: number }[];
        totalCentavos: number;
      }
    | {
        form: "1604E";
        year: number;
        period: { start: string; end: string; label: string };
        taxpayer: { registeredName?: string | null; tin?: string | null; branchCode?: string | null; rdoCode?: string | null; address?: string | null };
        payees: { tin: string | null; payee: string; atc: string; rateBp: number; baseCentavos: number; taxCentavos: number }[];
        totals: { baseCentavos: number; taxCentavos: number };
      },
): Promise<Uint8Array> {
  const stem = report.form === "0619E" ? "0619e-2018-01" : report.form === "1601EQ" ? "1601eq-2019-01" : "1604e-2018-01";
  const doc = await loadVerifiedTemplate(stem);
  const fonts = await loadFonts(doc);
  const pages = doc.getPages();
  const { tin9, branch } = normalizeTinBranch(report.taxpayer.tin, report.taxpayer.branchCode);
  const rdo = normalizeRdo(report.taxpayer.rdoCode);

  const moneyCells = (page: PDFPage, h: number, centavos: number, top: number, kind: "base" | "monthly" | "tax") => {
    const abs = Math.abs(Math.round(centavos));
    const whole = Math.floor(abs / 100);
    const cents = String(abs % 100).padStart(2, "0");
    const digits = `${centavos < 0 ? "-" : ""}${whole}`.split("").reverse();
    const [last, centX] = kind === "base" ? [268.5, 297.7] : kind === "monthly" ? [543.6, 571.9] : [542.2, 571.7];
    for (let i = 0; i < digits.length && i < 12; i++) {
      drawCentered(page, fonts.monoBold, digits[i]!, last - 14.3 * i, h - top, 9);
    }
    drawCentered(page, fonts.monoBold, cents[0]!, centX, h - top, 9);
    drawCentered(page, fonts.monoBold, cents[1]!, centX + 14.3, h - top, 9);
  };

  // Page 1 Identity
  const p1 = pages[0]!;
  const h1 = p1.getHeight();
  const idCfg =
    report.form === "0619E"
      ? { groups: [224.8, 282.6, 340.6], top: 178.5, name: [23, 205] as const, addr: [23, 234] as const, bFirst: 399.5, bStep: 14.3, rFirst: 543.5, rStep: 14.3 }
      : report.form === "1601EQ"
        ? { groups: [240.5, 297.7, 354.9], top: 157.0, name: [23, 183.5] as const, addr: [23, 212] as const, bFirst: 412.5, bStep: 14.3, rFirst: 557.0, rStep: 14.3 }
        : { groups: [242.5, 299.7, 356.9], top: 170.5, name: [28, 201] as const, addr: [28, 234] as const, bFirst: 414.5, bStep: 13.6, rFirst: 555.5, rStep: 14.2 };

  if (tin9.length === 9) {
    const tinCentres = idCfg.groups.flatMap((g) => [0, 1, 2].map((i) => g + i * 14.3));
    drawBoxes(p1, fonts.monoBold, tin9, tinCentres, h1 - idCfg.top, 9);
  }
  drawBoxes(p1, fonts.monoBold, branch, [0, 1, 2, 3, 4].map((i) => idCfg.bFirst + i * idCfg.bStep), h1 - idCfg.top, 9);
  drawBoxes(p1, fonts.monoBold, rdo, [0, 1, 2].map((i) => idCfg.rFirst + i * idCfg.rStep), h1 - idCfg.top, 9);
  fitText(p1, fonts.regular, report.taxpayer.registeredName, idCfg.name[0], h1 - idCfg.name[1], 565, 9);
  fitText(p1, fonts.regular, report.taxpayer.address, idCfg.addr[0], h1 - idCfg.addr[1], 550, 8);

  if (report.form === "0619E") {
    const [y = "2026", m = "01"] = report.period.start.split("-");
    drawBoxes(p1, fonts.monoBold, `${m}${y}`, [0, 1, 2, 3, 4, 5].map((i) => 53.5 + i * 14.3), h1 - 142.7, 9);
    const anyHeld = report.rows.some((r) => r.taxCentavos !== 0);
    drawCentered(p1, fonts.bold, "X", anyHeld ? 383.5 : 427.3, h1 - 144, 10);
    moneyCells(p1, h1, report.totalCentavos, 336.5, "monthly");
  } else if (report.form === "1601EQ") {
    drawBoxes(p1, fonts.monoBold, String(report.year), [0, 1, 2, 3].map((i) => 39.1 + i * 14.3), h1 - 122.2, 9);
    drawCentered(p1, fonts.bold, "X", [124.3, 168.3, 211.3, 255.3][report.quarter - 1]!, h1 - 123.3, 10);
    const anyHeld = report.rows.some((r) => r.taxCentavos !== 0);
    drawCentered(p1, fonts.bold, "X", anyHeld ? 413.3 : 456.3, h1 - 123.3, 10);

    report.rows.slice(0, 6).forEach((r, idx) => {
      const top = 310.0 + 17.44 * idx;
      drawBoxes(p1, fonts.monoBold, r.atc, [0, 1, 2, 3, 4].map((i) => 39.1 + i * 14.3), h1 - top, 9);
      moneyCells(p1, h1, r.baseCentavos, top, "base");
      fitText(p1, fonts.regular, `${r.rateBp / 100}%`, 335, h1 - top, 45, 8);
      moneyCells(p1, h1, r.taxCentavos, top, "tax");
    });
    moneyCells(p1, h1, report.totalCentavos, 414.7, "tax");
    if (report.rows.length > 6) {
      fitText(p1, fonts.regular, `INCLUDES ${report.rows.length} ATCS - SEE ATTACHED CONTINUATION SCHEDULE`, 23, h1 - 20, 560, 7.5);
    }
  } else {
    drawBoxes(p1, fonts.monoBold, String(report.year).slice(-2), [179.0, 197.5], h1 - 131.5, 9);
    if (pages[1]) {
      const p2 = pages[1];
      const h2 = p2.getHeight();
      fitText(p2, fonts.regular, report.taxpayer.registeredName, 225, h2 - 130, 362, 9);
      const tinFull = `${tin9}${branch}`;
      drawBoxes(p2, fonts.monoBold, tinFull, tinFull.split("").map((_, j) => 28.5 + j * 13.75), h2 - 134.0, 9);
      fitText(p2, fonts.regular, "SEE ATTACHED REVIEW ALPHALIST - ELECTRONIC ACCEPTANCE NOT VERIFIED", 150, h2 - 229, 265, 6.5);
      drawRight(p2, fonts.bold, formatPhp(report.totals.baseCentavos), 442, h2 - 271, 8);
      drawRight(p2, fonts.bold, formatPhp(report.totals.taxCentavos), 584, h2 - 271, 8);
    }
  }

  for (const p of pages) {
    const h = p.getHeight();
    drawCentered(p, fonts.bold, "DRAFT / REVIEW ONLY - NOT FOR FILING - ACTUAL PAYMENTS NOT VERIFIED", 306, h - 8, 8, RED);
  }

  // Automatic Continuation Schedule for 1601-EQ when >6 ATCs (e.g. Sir Mel's 7-ATC Q1 / 10-ATC Q3 returns)
  if (report.form === "1601EQ" && report.rows.length > 6) {
    const sched = doc.addPage([612, 936]);
    let y = 890;
    sched.drawText("1601EQ - ATC Continuation Schedule (Draft)", { x: 36, y, size: 14, font: fonts.bold, color: BLACK });
    y -= 18;
    const tinLabel = tin9.length === 9 ? `${tin9.slice(0, 3)}-${tin9.slice(3, 6)}-${tin9.slice(6, 9)}-${branch}` : "TIN missing";
    fitText(sched, fonts.regular, `${report.taxpayer.registeredName ?? ""} | TIN ${tinLabel} | ${report.period.label}`, 36, y, 540, 8.5, 7, SLATE);
    y -= 14;
    sched.drawText("NOT FOR FILING. Lists all expanded withholding tax ATCs when more than six appear in the quarter.", { x: 36, y, size: 8, font: fonts.regular, color: RED });
    y -= 22;

    sched.drawRectangle({ x: 36, y: y - 4, width: 540, height: 18, color: HEADER_BG });
    sched.drawText("ATC", { x: 42, y, size: 8, font: fonts.bold, color: BLACK });
    sched.drawText("Nature of income payment", { x: 96, y, size: 8, font: fonts.bold, color: BLACK });
    drawRight(sched, fonts.bold, "Tax base PHP", 425, y, 8);
    drawRight(sched, fonts.bold, "Rate", 475, y, 8);
    drawRight(sched, fonts.bold, "Tax withheld PHP", 570, y, 8);
    y -= 20;

    let sumBase = 0;
    for (const r of report.rows) {
      sumBase += r.baseCentavos;
      sched.drawText(pdfSafe(r.atc), { x: 42, y, size: 8, font: fonts.regular, color: BLACK });
      fitText(sched, fonts.regular, r.nature, 96, y, 235, 8, 6.5);
      drawRight(sched, fonts.regular, formatPhp(r.baseCentavos), 425, y, 8);
      drawRight(sched, fonts.regular, `${r.rateBp / 100}%`, 475, y, 8);
      drawRight(sched, fonts.regular, formatPhp(r.taxCentavos), 570, y, 8);
      sched.drawLine({ start: { x: 36, y: y - 5 }, end: { x: 576, y: y - 5 }, thickness: 0.4, color: BORDER });
      y -= 18;
    }
    sched.drawLine({ start: { x: 36, y: y + 12 }, end: { x: 576, y: y + 12 }, thickness: 1, color: SLATE });
    sched.drawText("TOTAL", { x: 42, y, size: 8.5, font: fonts.bold, color: BLACK });
    drawRight(sched, fonts.bold, formatPhp(sumBase), 425, y, 8.5);
    drawRight(sched, fonts.bold, formatPhp(report.totalCentavos), 570, y, 8.5);
  }

  // Annual Alphalist Appendix for 1604-E
  if (report.form === "1604E") {
    let page = doc.addPage([612, 936]);
    let y = 890;
    const drawHeader = () => {
      page.drawText("1604E - Calculated Annual Alphalist Review (Draft)", { x: 36, y, size: 13, font: fonts.bold, color: BLACK });
      y -= 16;
      page.drawText("NOT FOR FILING. Computed withholding is not proof of BIR remittance.", { x: 36, y, size: 8, font: fonts.regular, color: RED });
      y -= 20;
      page.drawRectangle({ x: 36, y: y - 4, width: 540, height: 18, color: HEADER_BG });
      page.drawText("Payee / TIN", { x: 42, y, size: 8, font: fonts.bold, color: BLACK });
      page.drawText("ATC", { x: 290, y, size: 8, font: fonts.bold, color: BLACK });
      drawRight(page, fonts.bold, "Income PHP", 425, y, 8);
      drawRight(page, fonts.bold, "Rate", 475, y, 8);
      drawRight(page, fonts.bold, "Withheld PHP", 570, y, 8);
      y -= 20;
    };
    drawHeader();
    for (const r of report.payees) {
      if (y < 60) {
        page = doc.addPage([612, 936]);
        y = 890;
        drawHeader();
      }
      fitText(page, fonts.regular, `${r.payee} (${r.tin ?? "TIN missing"})`, 42, y, 240, 8, 6);
      page.drawText(pdfSafe(r.atc), { x: 290, y, size: 8, font: fonts.regular, color: BLACK });
      drawRight(page, fonts.regular, formatPhp(r.baseCentavos), 425, y, 8);
      drawRight(page, fonts.regular, `${r.rateBp / 100}%`, 475, y, 8);
      drawRight(page, fonts.regular, formatPhp(r.taxCentavos), 570, y, 8);
      y -= 16;
    }
    page.drawLine({ start: { x: 36, y: y + 10 }, end: { x: 576, y: y + 10 }, thickness: 1, color: SLATE });
    page.drawText("TOTAL", { x: 42, y, size: 8.5, font: fonts.bold, color: BLACK });
    drawRight(page, fonts.bold, formatPhp(report.totals.baseCentavos), 425, y, 8.5);
    drawRight(page, fonts.bold, formatPhp(report.totals.taxCentavos), 570, y, 8.5);
  }

  doc.setTitle(`${report.form} review draft - not for filing`);
  return doc.save();
}

// ------------------------------------------------------------------ 2307 Official Jan 2018 v3

export async function render2307Pdf(report: {
  period: { start: string; end: string };
  taxpayer: { registeredName?: string | null; tin?: string | null; branchCode?: string | null; address?: string | null };
  certificate: {
    payee: { name?: string | null; tin?: string | null; branchCode?: string | null; address?: string | null };
    rows: { atc: string; nature: string; months: [number, number, number]; baseCentavos: number; taxCentavos: number }[];
    totals: { baseCentavos: number; taxCentavos: number };
  };
}): Promise<Uint8Array> {
  const doc = await loadVerifiedTemplate("2307-2018-01");
  const fonts = await loadFonts(doc);
  const page = doc.getPages()[0]!;
  const H = 936;
  const TIN_X = [213.4, 226.6, 239.7, 264.9, 278.1, 291.3, 316.5, 329.7, 342.9];
  const BRANCH_X = [368.7, 383.6, 398.7, 414.4, 428.7];
  const FROM_X = [157.9, 171.5, 185.1, 197.9, 210.6, 224.0, 237.5, 250.5];
  const TO_X = FROM_X.map((x) => x + 247.6);

  const ymdToMdy = (iso: string) => {
    const [y = "", m = "", d = ""] = iso.split("-");
    return `${m}${d}${y}`;
  };
  drawBoxes(page, fonts.monoBold, ymdToMdy(report.period.start), FROM_X, H - 116.2, 9);
  drawBoxes(page, fonts.monoBold, ymdToMdy(report.period.end), TO_X, H - 116.2, 9);

  const missing: string[] = [];
  const parties = [
    { label: "Payee", p: report.certificate.payee, tinTop: 148.2, nameTop: 175, addrTop: 204 },
    { label: "Payor", p: { name: report.taxpayer.registeredName, ...report.taxpayer }, tinTop: 263.2, nameTop: 290, addrTop: 319 },
  ];
  for (const item of parties) {
    const { tin9, branch } = normalizeTinBranch(item.p.tin, item.p.branchCode);
    if (!tin9) missing.push(`${item.label}: TIN`);
    if (!item.p.address) missing.push(`${item.label}: address`);
    if (!item.p.name) missing.push(`${item.label}: name`);
    if (tin9.length === 9) drawBoxes(page, fonts.monoBold, tin9, TIN_X, H - item.tinTop, 9);
    drawBoxes(page, fonts.monoBold, branch, BRANCH_X, H - item.tinTop, 9);
    fitText(page, fonts.regular, item.p.name, 37, H - item.nameTop, 552, 9);
    fitText(page, fonts.regular, item.p.address, 37, H - item.addrTop, 495, 8);
  }

  const cert = report.certificate;
  const cols = [289, 363.4, 435.5, 507.5, 592];
  cert.rows.slice(0, 10).forEach((r, idx) => {
    const baseY = H - (375.3 + idx * 13.68);
    fitText(page, fonts.regular, r.nature, 21, baseY, 153, 7, 5.5);
    fitText(page, fonts.regular, r.atc, 181, baseY, 34, 8);
    const vals = [...r.months, r.baseCentavos, r.taxCentavos];
    vals.forEach((v, ci) => drawRight(page, fonts.regular, formatPhp(v), cols[ci]!, baseY, 8));
  });

  const mTotals = [0, 1, 2].map((i) => cert.rows.reduce((s, r) => s + (r.months[i] ?? 0), 0));
  const totalVals = [...mTotals, cert.totals.baseCentavos, cert.totals.taxCentavos];
  totalVals.forEach((v, ci) => drawRight(page, fonts.bold, formatPhp(v), cols[ci]!, H - 512, 8));

  drawCentered(page, fonts.bold, "DRAFT / REVIEW ONLY - NOT FOR FILING - NO SIGNATURE", 306, 40, 8, RED);
  if (missing.length) {
    fitText(page, fonts.regular, `MISSING: ${missing.join(", ")}`, 20, H - 910, 574, 7, 5.5, RED);
  }

  if (cert.rows.length > 10) {
    const sched = doc.addPage([612, 936]);
    let y = 890;
    sched.drawText("BIR Form 2307 - ATC Continuation Schedule (Draft)", { x: 36, y, size: 13, font: fonts.bold, color: BLACK });
    y -= 20;
    for (const r of cert.rows) {
      fitText(sched, fonts.regular, `${r.atc} - ${r.nature}`, 36, y, 250, 8, 6);
      drawRight(sched, fonts.regular, formatPhp(r.baseCentavos), 430, y, 8);
      drawRight(sched, fonts.regular, formatPhp(r.taxCentavos), 550, y, 8);
      y -= 16;
    }
  }

  doc.setTitle("2307 review certificate - not for filing");
  return doc.save();
}

// ------------------------------------------------------------------ 2550Q Official April 2024 Draft

export async function render2550qPdf(report: {
  year: number;
  quarter: number;
  period: { start: string; end: string };
  taxpayer: { registeredName?: string | null; tin?: string | null; branchCode?: string | null; rdoCode?: string | null; address?: string | null; fiscalMonthEnd?: number };
  totals?: {
    taxableSalesCentavos: number;
    zeroRatedSalesCentavos: number;
    exemptSalesCentavos: number;
    outputVatCentavos: number;
    vatablePurchasesCentavos: number;
    otherPurchasesCentavos: number;
    inputVatCentavos: number;
    govVatWithheldCentavos: number;
    netVatPayableCentavos: number;
  };
}): Promise<Uint8Array> {
  const doc = await loadVerifiedTemplate("2550q-2024-04");
  const fonts = await loadFonts(doc);
  const pages = doc.getPages();
  const H = 1008;
  const { tin9, branch } = normalizeTinBranch(report.taxpayer.tin, report.taxpayer.branchCode);
  const rdo = normalizeRdo(report.taxpayer.rdoCode);

  const p1 = pages[0]!;
  const ym = `${String(report.taxpayer.fiscalMonthEnd ?? 12).padStart(2, "0")}${report.year}`;
  ym.split("").forEach((ch, i) => drawCentered(p1, fonts.monoBold, ch, 309.5 + 14.35 * i, H - 118, 9));
  const mdy = (iso: string) => `${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(0, 4)}`;
  mdy(report.period.start).split("").forEach((ch, i) => drawCentered(p1, fonts.monoBold, ch, 68.0 + 14.0 * i, H - 147, 9));
  mdy(report.period.end).split("").forEach((ch, i) => drawCentered(p1, fonts.monoBold, ch, 209.0 + 14.0 * i, H - 147, 9));
  p1.drawText("X", { x: (report.taxpayer.fiscalMonthEnd ?? 12) === 12 ? 78 : 145, y: H - 121, size: 10, font: fonts.bold, color: BLACK });
  p1.drawText("X", { x: [439, 477, 520, 561][report.quarter - 1]!, y: H - 121, size: 10, font: fonts.bold, color: BLACK });
  fitText(p1, fonts.regular, report.taxpayer.registeredName, 25, H - 200 - 10, 562, 10);
  fitText(p1, fonts.regular, report.taxpayer.address, 25, H - 229 - 9, 562, 9);
  rdo.split("").forEach((ch, i) => drawCentered(p1, fonts.monoBold, ch, 554.5 + 14.25 * i, H - 179, 9));
  if (tin9.length === 9) {
    tin9.split("").forEach((ch, i) => {
      const g = Math.floor(i / 3);
      const off = i % 3;
      drawCentered(p1, fonts.monoBold, ch, [240.5, 297.7, 354.9][g]! + off * 14.15, H - 179, 9);
    });
  }

  const drawMoney = (page: PDFPage, centavos: number, col: "A" | "B", top: number) => {
    const abs = Math.abs(Math.round(centavos));
    const whole = Math.floor(abs / 100);
    const frac = String(abs % 100).padStart(2, "0");
    const digits = `${centavos < 0 ? "-" : ""}${whole}`.split("").reverse();
    const [last, firstCent] = col === "A" ? [325.8, 354.7] : [539.5, 568.5];
    const baseline = H - top - 7;
    for (let i = 0; i < digits.length && i < 12; i++) {
      drawCentered(page, fonts.monoBold, digits[i]!, last - 14.25 * i, baseline, 9);
    }
    drawCentered(page, fonts.monoBold, frac[0]!, firstCent, baseline, 9);
    drawCentered(page, fonts.monoBold, frac[1]!, firstCent + 14.25, baseline, 9);
  };

  if (report.totals) {
    const t = report.totals;
    // Page 1 summary items (15 = output VAT, 17C/20A-style mapped lines -> 21 net VAT)
    drawMoney(p1, t.outputVatCentavos, "B", 346.4); // Item 15 Total Output Tax
    drawMoney(p1, t.inputVatCentavos, "B", 465.2); // Item 21 Allowable Input Tax
    drawMoney(p1, t.netVatPayableCentavos, "B", 482.8); // Item 22 Net VAT Payable / Excess
    drawMoney(p1, t.govVatWithheldCentavos, "B", 500.4); // Item 23 Creditable VAT Withheld

    const p2 = pages[1]!;
    fitText(p2, fonts.regular, report.taxpayer.registeredName, 225, H - 91 - 10, 360, 10);
    if (tin9.length === 9) {
      tin9.split("").forEach((ch, i) => drawCentered(p2, fonts.monoBold, ch, 27.0 + i * 13.3, H - 101, 9));
    }
    // Page 2 Part IV sales & purchases schedules (lines 31..43)
    drawMoney(p2, t.taxableSalesCentavos, "A", 136.2); // 31A VATable sales
    drawMoney(p2, t.outputVatCentavos, "B", 136.2); // 31B Output VAT
    drawMoney(p2, t.zeroRatedSalesCentavos, "A", 168.1); // 33A Zero-rated sales
    drawMoney(p2, t.exemptSalesCentavos, "A", 184.9); // 34A Exempt sales
    drawMoney(p2, t.vatablePurchasesCentavos, "A", 371.2); // 44A Domestic purchases
    drawMoney(p2, t.inputVatCentavos, "B", 371.2); // 44B Input VAT
  }

  for (const p of pages) {
    drawCentered(p, fonts.bold, `DRAFT / TEST ONLY - NOT FOR FILING (Branch ${branch})`, 306, 18, 9, RED);
  }

  doc.setTitle("2550Q review draft - not for filing");
  return doc.save();
}
