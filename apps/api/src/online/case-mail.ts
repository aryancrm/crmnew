// The customer hears of their case's own steps by email, as in the old CRM (backend/apps/crm/src/
// customer-mail.ts; Aryan, 26 Nov: "everything was automatic"): thank you for contacting us, the
// quotation itself with its PDF (PCSO's three once all three are there), the guarantee letter
// received, and verified. The order's own steps (confirmed, on the way, delivered, paid) go as
// they always did (tell.ts). There is no "prescription checked" email: Management reads the
// prescription when it approves the order (Aryan, 19 Nov).
//
// Off until the Admin switches them on (Admin → Company details → Automatic emails), as the old
// CRM's owner decided, so nobody gets an email the company didn't mean. From the mailbox the
// case talks on, else the company's first (each company its own). Once per step and case; the
// quotation once per save. A failure never stops the step it follows: it is written on the case.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { caseMailSettings, companyInfo } from "../settings/service";
import type { CaseMailEvent, Me } from "../types";
import { sendFromMailbox, sendOnCase, startEmailThread } from "./email";
import { emailQuotation } from "./quotation";
import { quotesNeeded } from "./rules";
import { leadCase } from "./service";

const LABEL: Record<CaseMailEvent, string> = {
  enquiry: "Thank you for contacting",
  quotation: "Quotation",
  gl_received: "Guarantee letter received",
  gl_verified: "Guarantee letter verified",
};
const AGENCY: Record<string, string> = { dswd: "DSWD", pcso: "PCSO", ovp: "the Office of the Vice President", op: "the Office of the President" };
const peso = (centavos: number) =>
  `₱${(centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type CaseRow = {
  code: string;
  name: string;
  email: string | null;
  state: string;
  road: string;
  agency: string | null;
  letterNo: string | null;
  amount: number | null;
  savedAt: string | null;
  sentAt: string | null;
  canvass: number;
};

/** The words of one step's email. */
function wordsOf(event: Exclude<CaseMailEvent, "quotation">, lead: CaseRow, company: string): { subject: string; text: string } {
  const first = lead.name.trim().split(/\s+/)[0] ?? "";
  const hello = `Hi${first ? ` ${first}` : ""},`;
  const agency = lead.agency ? AGENCY[lead.agency] : null;
  if (event === "enquiry")
    return {
      subject: `We got your message (${lead.code})`,
      text: [hello, "", `Thank you for contacting ${company}. We got your message and will reply soon.`, "", `Your reference: ${lead.code}.`, "", company].join("\n"),
    };
  const letter = `${lead.letterNo ? ` no. ${lead.letterNo}` : ""}${agency ? ` from ${agency}` : ""}${lead.amount ? ` for ${peso(lead.amount)}` : ""}`;
  if (event === "gl_received")
    return {
      subject: `Your guarantee letter is in (${lead.code})`,
      text: [hello, "", `We received your guarantee letter${letter}. We are checking it with your papers, and will tell you when your order is confirmed.`, "", `Your reference: ${lead.code}.`, "", company].join("\n"),
    };
  return {
    subject: `Your guarantee letter is verified (${lead.code})`,
    text: [hello, "", `Your guarantee letter${letter} is verified. Your order goes ahead now; we will tell you when it is on the way.`, "", `Your reference: ${lead.code}.`, "", company].join("\n"),
  };
}

/** Emails the customer one step of their case, if the company switched it on. Answers whether it went. */
export async function tellCase(db: Database, me: Me | null, leadId: number, event: CaseMailEvent): Promise<boolean> {
  const label = `Emailed the customer: ${LABEL[event]}`;
  try {
    const settings = await caseMailSettings(db);
    if (!settings.enabled || !settings.events[event]) return false;
    const [lead] = await rows<CaseRow>(
      db,
      sql`select l.code, l.name, l.email, l.state, l.road, l.agency, l.gl_letter_no as "letterNo", l.gl_amount::int as amount,
          to_char(l.quote_saved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "savedAt",
          to_char(l.quote_sent_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "sentAt",
          jsonb_array_length(l.canvass)::int as canvass
        from lead l where l.id = ${leadId}`,
    );
    if (!lead?.email || lead.state !== "open") return false;

    if (event === "quotation") {
      // Once per save; PCSO's when all three are there (its two others filled or typed).
      if (!me || !lead.savedAt || (lead.sentAt && lead.sentAt >= lead.savedAt)) return false;
      if (quotesNeeded(lead.road, lead.agency) > 1 && lead.canvass < 2 && !(await leadCase(db, me, leadId)).canvassAuto)
        return false;
      if (!(await emailQuotation(db, me, leadId))) return false;
      await db.execute(
        sql`insert into lead_event (lead_id, kind, message, by_person) values (${leadId}, 'email', ${`${label} (by itself, with its PDF)`}, ${me.id})`,
      );
      return true;
    }

    const [done] = await rows<{ one: number }>(
      db,
      sql`select 1 as one from lead_event where lead_id = ${leadId} and kind = 'email' and message like ${`${label}%`} limit 1`,
    );
    if (done) return false;
    const company = (await companyInfo(db)).name;
    const words = wordsOf(event, lead, company);
    let sent = false;
    if (await startEmailThread(db, leadId)) {
      await sendOnCase(db, leadId, words.text, { subject: words.subject }, me?.id ?? null);
      sent = true;
    } else sent = await sendFromMailbox(db, { to: lead.email, subject: words.subject, text: words.text });
    if (!sent) return false;
    await db.execute(
      sql`insert into lead_event (lead_id, kind, message, by_person) values (${leadId}, 'email', ${`${label} (${words.subject})`}, ${me?.id ?? null})`,
    );
    return true;
  } catch (error) {
    await db
      .execute(
        sql`insert into lead_event (lead_id, kind, message, by_person) values (${leadId}, 'status', ${`Automatic email "${LABEL[event]}" not sent: ${error instanceof Error ? error.message : "the mailbox refused it"}`}, ${me?.id ?? null})`,
      )
      .catch(() => {});
    return false;
  }
}
