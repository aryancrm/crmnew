// The quotation the customer receives: one A4 page (more when the list is long) on the company's
// letterhead, made from the case's saved quotation. Staff open it as a PDF, or send it: as a link
// (frozen as it was, for 30 days) or attached to an email. Drawn with pdf-lib's standard fonts,
// which have no peso sign: amounts read "PHP 1,234.00".

import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import {
  PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  rgb,
  StandardFonts,
} from "pdf-lib";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { companyInfo } from "../settings/service";
import type { CompanyInfo, LeadCase, Me } from "../types";
import { replyByEmail } from "./email";
import { replyOnMessenger } from "./messenger";
import { LEAD_READ_ROLES, LEAD_WORK_ROLES } from "./rules";
import { leadCase, leadGate, quoteSent } from "./service";

export type QuotationSnapshot = {
  company: CompanyInfo;
  /** "November 15, 2026", the Manila day it was made. */
  date: string;
  reference: string;
  patient: string;
  to: string;
  contact: string;
  address: string;
  road: "regular" | "senior" | "pwd" | "gl";
  agency: string | null;
  /** Centavos. */
  lines: { no: number; description: string; qty: number; price: number; total: number }[];
  subtotal: number;
  relief: { vatRemoved: number; discount: number } | null;
  deliveryFee: number;
  points: number;
  total: number;
  toPay: number;
  validityDays: number;
  preparedBy: string;
  /** PCSO's price canvass: the two other vendors' totals, printed one page each after ours. */
  canvass?: { vendor: string; amount: number }[];
};

const AGENCY: Record<string, string> = {
  dswd: "DSWD (AICS)",
  pcso: "PCSO (IMAP)",
  ovp: "Office of the Vice President",
  op: "Office of the President",
};

const longDate = (at = new Date()) =>
  new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  }).format(at);
export const money = (centavos: number) =>
  `PHP ${(centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What the case's saved quotation says now, ready to print. */
export function snapshotOf(data: LeadCase, company: CompanyInfo, me: Me): QuotationSnapshot {
  const { lead, quote } = data;
  if (!quote.lines.length) throw new Refusal(409, "not_now", "Save the quotation first.");
  if (quote.stale)
    throw new Refusal(
      409,
      "not_now",
      "The quotation was saved for another road: save it again for this one.",
    );
  const deliveryFee = data.web?.money.deliveryFee ?? 0;
  const points = lead.road === "regular" ? data.points.toUse : 0;
  const total = quote.total + deliveryFee;
  return {
    company,
    date: longDate(),
    reference: lead.code,
    patient: lead.patientName ?? lead.name,
    to: lead.name,
    contact: lead.phone ?? lead.email ?? "",
    address: [lead.address, lead.city].filter(Boolean).join(", "),
    road: lead.road,
    agency: lead.agency,
    lines: quote.lines.map((line, index) => ({
      no: index + 1,
      description: line.medicine,
      qty: line.qty,
      price: line.unitPrice,
      total: line.qty * line.unitPrice,
    })),
    subtotal: quote.subtotal,
    relief: quote.relief,
    deliveryFee,
    points,
    total,
    toPay: Math.max(0, total - points * 100),
    validityDays: 30,
    preparedBy: me.name,
    canvass: lead.road === "gl" && lead.agency === "pcso" ? lead.canvass : [],
  };
}

// ---------------------------------------------------------------- drawing

const PAGE = { w: 595.28, h: 841.89 };
const LEFT = 48;
const RIGHT = PAGE.w - 48;
const INK = rgb(0.1, 0.1, 0.12);
const SOFT = rgb(0.38, 0.4, 0.45);
const LINE = rgb(0.82, 0.84, 0.87);
const BRAND = rgb(0.016, 0.47, 0.34);
const HEAD = rgb(0.93, 0.97, 0.95);

let logoBytes: Uint8Array | null | undefined;
async function logo(): Promise<Uint8Array | null> {
  if (logoBytes === undefined)
    logoBytes = await readFile(
      fileURLToPath(new URL("../../assets/2mg-logo.png", import.meta.url)),
    ).catch(() => null);
  return logoBytes;
}

/** Only what the standard fonts can draw. */
const plain = (text: string) =>
  text
    .replace(/₱/g, "PHP ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/·/g, "-")
    .replace(/×/g, "x")
    .replace(/ñ/g, "n")
    .replace(/Ñ/g, "N")
    .replace(/[^\x20-\x7E]/g, "");

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of plain(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

export async function drawQuotation(s: QuotationSnapshot): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Quotation for ${plain(s.patient)}`);
  doc.setAuthor(plain(s.company.name));
  const body = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const bytes = await logo();
  const image: PDFImage | null = bytes ? await doc.embedPng(bytes).catch(() => null) : null;
  const pages: PDFPage[] = [];
  let page = doc.addPage([PAGE.w, PAGE.h]);
  pages.push(page);
  let y = 0;

  const text = (
    value: string,
    x: number,
    top: number,
    options: {
      font?: PDFFont;
      size?: number;
      color?: ReturnType<typeof rgb>;
      align?: "right";
    } = {},
  ) => {
    const font = options.font ?? body;
    const size = options.size ?? 10;
    const said = plain(value);
    const width = font.widthOfTextAtSize(said, size);
    page.drawText(said, {
      x: options.align === "right" ? x - width : x,
      y: PAGE.h - top,
      font,
      size,
      color: options.color ?? INK,
    });
    return width;
  };
  const rule = (top: number, color = LINE, thickness = 0.7) =>
    page.drawLine({
      start: { x: LEFT, y: PAGE.h - top },
      end: { x: RIGHT, y: PAGE.h - top },
      thickness,
      color,
    });

  // The letterhead: the logo on the left, the company on the right.
  const header = () => {
    if (image) {
      const scale = Math.min(140 / image.width, 46 / image.height);
      page.drawImage(image, {
        x: LEFT,
        y: PAGE.h - 40 - image.height * scale,
        width: image.width * scale,
        height: image.height * scale,
      });
    }
    let top = 42;
    text(s.company.name.toUpperCase(), RIGHT, top, { font: bold, size: 11, align: "right" });
    for (const part of wrap(s.company.address, body, 7.5, 260)) {
      top += 10;
      text(part, RIGHT, top, { size: 7.5, color: SOFT, align: "right" });
    }
    const contact = [
      s.company.phone && `T: ${s.company.phone}`,
      s.company.email && `E: ${s.company.email}`,
    ]
      .filter(Boolean)
      .join("   ");
    if (contact) {
      top += 10;
      text(contact, RIGHT, top, { size: 7.5, color: SOFT, align: "right" });
    }
    const papers = [
      s.company.licence && `LTO: ${s.company.licence}`,
      s.company.tin && `TIN: ${s.company.tin}`,
    ]
      .filter(Boolean)
      .join("   ");
    if (papers) {
      top += 10;
      text(papers, RIGHT, top, { size: 7.5, color: SOFT, align: "right" });
    }
    y = Math.max(top, 96) + 14;
    rule(y, BRAND, 1.4);
    y += 26;
  };
  header();

  text("PRICE QUOTATION", LEFT, y, { font: bold, size: 15 });
  text(`Date: ${s.date}`, RIGHT, y - 4, { size: 9, align: "right" });
  text(`Reference: ${s.reference}`, RIGHT, y + 8, { size: 9, align: "right" });
  y += 30;
  const facts: [string, string][] = [
    ["Patient", s.patient],
    ...(s.to !== s.patient ? ([["For", s.to]] as [string, string][]) : []),
    ["Contact", s.contact],
    ...(s.address ? ([["Address", s.address]] as [string, string][]) : []),
    ...(s.road === "gl"
      ? ([["Assistance", `Guarantee letter, ${AGENCY[s.agency ?? ""] ?? "agency"}`]] as [
          string,
          string,
        ][])
      : []),
  ];
  for (const [label, value] of facts) {
    text(label, LEFT, y, { font: bold, size: 9, color: SOFT });
    for (const [index, part] of wrap(value, body, 10, RIGHT - LEFT - 80).entries())
      text(part, LEFT + 80, y + index * 13, { size: 10 });
    y += 13 * Math.max(1, wrap(value, body, 10, RIGHT - LEFT - 80).length) + 3;
  }
  y += 12;

  // The medicines.
  const cols = {
    no: LEFT + 6,
    item: LEFT + 30,
    qty: LEFT + 330,
    price: LEFT + 420,
    total: RIGHT - 6,
  };
  const tableHead = () => {
    page.drawRectangle({
      x: LEFT,
      y: PAGE.h - y - 8,
      width: RIGHT - LEFT,
      height: 22,
      color: HEAD,
    });
    text("No.", cols.no, y + 6, { font: bold, size: 9 });
    text("Item description", cols.item, y + 6, { font: bold, size: 9 });
    text("Qty", cols.qty, y + 6, { font: bold, size: 9, align: "right" });
    text("Unit price", cols.price, y + 6, { font: bold, size: 9, align: "right" });
    text("Amount", cols.total, y + 6, { font: bold, size: 9, align: "right" });
    y += 26;
  };
  tableHead();
  for (const line of s.lines) {
    const parts = wrap(line.description, body, 10, cols.qty - cols.item - 50);
    const height = Math.max(20, parts.length * 13 + 7);
    if (y + height > PAGE.h - 150) {
      page = doc.addPage([PAGE.w, PAGE.h]);
      pages.push(page);
      y = 60;
      tableHead();
    }
    text(String(line.no), cols.no, y + 4, { size: 9, color: SOFT });
    parts.forEach((part, index) => text(part, cols.item, y + 4 + index * 13, { size: 10 }));
    text(line.qty.toLocaleString("en-PH"), cols.qty, y + 4, { size: 10, align: "right" });
    text(money(line.price), cols.price, y + 4, { size: 9.5, align: "right" });
    text(money(line.total), cols.total, y + 4, { size: 9.5, align: "right" });
    y += height;
    rule(y - 6);
  }

  // The sums.
  if (y > PAGE.h - 230) {
    page = doc.addPage([PAGE.w, PAGE.h]);
    pages.push(page);
    y = 60;
  }
  y += 8;
  const sum = (label: string, value: string, strong = false) => {
    text(label, cols.price - 20, y, {
      font: strong ? bold : body,
      size: strong ? 11 : 9.5,
      align: "right",
    });
    text(value, cols.total, y, {
      font: strong ? bold : body,
      size: strong ? 11 : 9.5,
      align: "right",
    });
    y += strong ? 18 : 14;
  };
  sum("Medicines", money(s.subtotal));
  if (s.relief) {
    if (s.relief.vatRemoved)
      sum("Less VAT (senior citizen / PWD)", `-${money(s.relief.vatRemoved)}`);
    sum("Less 20% discount (RA 9994 / RA 10754)", `-${money(s.relief.discount)}`);
  }
  if (s.deliveryFee) sum("Delivery fee", money(s.deliveryFee));
  y += 2;
  page.drawLine({
    start: { x: cols.price - 160, y: PAGE.h - y + 10 },
    end: { x: RIGHT, y: PAGE.h - y + 10 },
    thickness: 0.8,
    color: INK,
  });
  y += 4;
  if (s.points) {
    sum("Total", money(s.total));
    sum(`Less ${s.points.toLocaleString("en-PH")} points`, `-${money(s.points * 100)}`);
    sum("Amount to pay", money(s.toPay), true);
  } else sum(s.road === "gl" ? "Total (to the agency)" : "Total", money(s.total), true);

  // The terms.
  y += 18;
  const terms = [
    `Valid for ${s.validityDays} days from ${s.date}. Prices may change after that without notice.`,
    s.road === "senior" || s.road === "pwd"
      ? "The VAT exemption and the 20% discount are for the patient named, against their senior citizen's or PWD's ID and prescription."
      : s.road === "gl"
        ? "For the guarantee letter: the agency pays the amount it approves; the patient pays any part it doesn't cover."
        : "",
    "Prescription medicines are released only against a valid prescription.",
  ].filter(Boolean);
  for (const term of terms)
    for (const part of wrap(`- ${term}`, body, 9, RIGHT - LEFT)) {
      text(part, LEFT, y, { size: 9, color: SOFT });
      y += 12;
    }
  y += 26;
  text("Prepared by", LEFT, y, { size: 8.5, color: SOFT });
  y += 14;
  text(s.company.signatory || s.preparedBy, LEFT, y, { font: bold, size: 10 });
  if (s.company.signatoryTitle)
    text(s.company.signatoryTitle, LEFT, y + 13, { size: 9, color: SOFT });
  text(s.company.vat ? "VAT-registered" : "Non-VAT", RIGHT, y, {
    size: 8.5,
    color: SOFT,
    align: "right",
  });

  // PCSO's price canvass: one page for each other vendor's quotation (ours is the first).
  const canvass = s.canvass ?? [];
  for (const [index, other] of canvass.entries()) {
    page = doc.addPage([PAGE.w, PAGE.h]);
    pages.push(page);
    text("PRICE CANVASS", LEFT, 70, { font: bold, size: 16, color: BRAND });
    text(`Quotation ${index + 2} of ${canvass.length + 1}`, RIGHT, 70, {
      font: bold,
      size: 11,
      align: "right",
    });
    rule(84, BRAND, 1.2);
    const rows: [string, string][] = [
      ["Patient", s.patient],
      ["For", AGENCY[s.agency ?? ""] ?? "Guarantee letter"],
      ["Vendor", other.vendor],
      ["Vendor's total", money(other.amount)],
      ["Our quotation", `${money(s.total)} (Quotation 1, ref. ${s.reference})`],
      ["Date", s.date],
    ];
    rows.forEach(([label, value], at) => {
      text(label, LEFT, 116 + at * 22, { size: 10, color: SOFT });
      text(value, LEFT + 120, 116 + at * 22, {
        font: label === "Vendor's total" ? bold : body,
        size: 10.5,
      });
    });
    rule(116 + rows.length * 22 + 4);
    text(
      `Canvassed from ${other.vendor}'s written quotation for the same medicines and quantities.`,
      LEFT,
      116 + rows.length * 22 + 26,
      { size: 9.5, color: SOFT },
    );
  }

  // The foot of every page.
  for (const [index, each] of pages.entries()) {
    const foot = plain(s.company.footer);
    if (foot)
      each.drawText(foot, {
        x: Math.max(LEFT, (PAGE.w - body.widthOfTextAtSize(foot, 7.5)) / 2),
        y: 24,
        font: body,
        size: 7.5,
        color: SOFT,
      });
    if (pages.length > 1)
      each.drawText(`Page ${index + 1} of ${pages.length}`, {
        x: RIGHT - body.widthOfTextAtSize(`Page ${index + 1} of ${pages.length}`, 7.5),
        y: 38,
        font: body,
        size: 7.5,
        color: SOFT,
      });
  }
  return doc.save();
}

export const fileName = (s: QuotationSnapshot) =>
  `Quotation ${s.reference} - ${plain(s.patient).replace(/[^\w .-]/g, "")}.pdf`;

// ---------------------------------------------------------------- opening and sending

/** The case's quotation as a PDF, for the desk to look at or print. */
export async function quotationPdf(
  db: Database,
  me: Me,
  leadId: number,
): Promise<{ bytes: Uint8Array; name: string }> {
  await leadGate(db, me, leadId, "read", "see a quotation");
  const snapshot = snapshotOf(await leadCase(db, me, leadId), await companyInfo(db), me);
  return { bytes: await drawQuotation(snapshot), name: fileName(snapshot) };
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** A link for the customer: the quotation as it is now, frozen, for 30 days. Answers its path. */
export async function quotationLink(
  db: Database,
  me: Me,
  leadId: number,
): Promise<{ path: string }> {
  await leadGate(db, me, leadId, "work", "make a quotation link");
  const snapshot = snapshotOf(await leadCase(db, me, leadId), await companyInfo(db), me);
  const token = randomBytes(24).toString("base64url");
  await db.execute(
    sql`insert into quotation_link (lead_id, token_hash, snapshot, expires_at, created_by)
      values (${leadId}, ${hash(token)}, ${JSON.stringify(snapshot)}::jsonb, now() + interval '30 days', ${me.id})`,
  );
  return { path: `/api/public/quotation/${token}` };
}

/** The customer opens their link (no sign-in): the PDF as it was when it was sent. */
export async function openQuotationLink(
  db: Database,
  token: string,
): Promise<{ bytes: Uint8Array; name: string }> {
  const [found] = await rows<{ id: number; snapshot: QuotationSnapshot; live: boolean }>(
    db,
    sql`select id::int as id, snapshot, expires_at > now() as live from quotation_link where token_hash = ${hash(token)}`,
  );
  if (!found) throw new Refusal(404, "not_found", "This quotation link isn't right.");
  if (!found.live)
    throw new Refusal(404, "not_found", "This quotation link has expired. Ask us for a new one.");
  await db.execute(
    sql`update quotation_link set opened_at = coalesce(opened_at, now()) where id = ${found.id}`,
  );
  return { bytes: await drawQuotation(found.snapshot), name: fileName(found.snapshot) };
}

/**
 * Sends the quotation the way the case talks to them: on Messenger its link, by email the PDF
 * attached (from the mailbox their email came to, else the first mailbox, which starts the email
 * conversation on the case). Then marks the quotation sent.
 */
export async function sendQuotation(
  db: Database,
  me: Me,
  leadId: number,
  input: { via: "messenger" | "email"; link?: string | null },
): Promise<void> {
  await leadGate(db, me, leadId, "work", "send a quotation");
  const data = await leadCase(db, me, leadId);
  const company = await companyInfo(db);
  const snapshot = snapshotOf(data, company, me);
  const name = (data.lead.name.split(/\s+/)[0] ?? "").trim();
  if (input.via === "messenger") {
    if (data.lead.chatChannel !== "messenger")
      throw new Refusal(409, "not_now", "This case didn't come through Messenger.");
    const link = input.link?.trim() ?? "";
    const token = link.split("/api/public/quotation/")[1] ?? "";
    const [owned] = token
      ? await rows<{ id: number }>(
          db,
          sql`select id::int as id from quotation_link where token_hash = ${hash(token)} and lead_id = ${leadId}`,
        )
      : [];
    if (!owned || !/^https?:\/\//.test(link))
      throw new Refusal(400, "invalid", "Make the quotation's link first.", "link");
    await replyOnMessenger(
      db,
      me,
      leadId,
      `Hi${name ? ` ${name}` : ""}! Here is your quotation from ${company.name}: ${money(snapshot.toPay).replace("PHP ", "₱")} in all. Open it here: ${link}`,
    );
  } else {
    const pdf = await drawQuotation(snapshot);
    if (data.lead.chatChannel !== "email") {
      // No email conversation yet: it starts with this one, from the first mailbox.
      if (!data.lead.email)
        throw new Refusal(409, "not_now", "Add their email address first (Case details).");
      const [mailbox] = await rows<{ id: number }>(
        db,
        sql`select id::int as id from channel_account where kind = 'email' and active order by id limit 1`,
      );
      if (!mailbox) throw new Refusal(409, "not_now", "No mailbox is connected (Channels).");
      if (data.lead.chatChannel)
        throw new Refusal(409, "not_now", "This case talks on Messenger: send the link there.");
      await db.execute(
        sql`update lead set chat_channel = 'email', chat_account_id = ${mailbox.id}, chat_key = ${data.lead.email.toLowerCase()} where id = ${leadId} and chat_key is null`,
      );
    }
    await replyByEmail(
      db,
      me,
      leadId,
      `Hello${name ? ` ${name}` : ""},\n\nPlease find attached our quotation ${snapshot.reference} for ${snapshot.patient}: ${money(snapshot.toPay)} in all, valid for ${snapshot.validityDays} days.\n\nReply to this email or call ${company.phone || "us"} to order.\n\n${company.name}`,
      {
        subject: `Your quotation from ${company.name} · ${snapshot.patient}`,
        attachments: [
          { filename: fileName(snapshot), content: pdf, contentType: "application/pdf" },
        ],
      },
    );
  }
  await quoteSent(db, me, leadId, input.via);
}
