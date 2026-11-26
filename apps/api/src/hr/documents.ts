// HR's documents (docs/HR-PLAN.md, "Documents, imports and reports", 26 Nov): the papers HR makes in
// the CRM, on the employer's letterhead, each with its own number by kind and year (COE-2026-00001):
//
// - a certificate of employment, with or without the pay, for a purpose the person gave;
// - a clearance: the team lead, Finance, Inventory and the Admin (logins and equipment) each sign
//   their part, with a note of anything still owed, then HR signs last;
// - a memo, and a notice to explain (answered in writing by a day): the person acknowledges it,
//   their signature as it stood that moment.
//
// What a paper says is kept the day it is issued (`content`), so a later printout reads the same
// even when the record changes. Nothing is deleted: a wrong paper is voided with the reason, and
// HR's trail writes every paper down. HR makes and voids; HR, the CEO and the Admin read all; the
// person reads their own; a clearance's signers read the clearances they sign.

import { sql } from "drizzle-orm";
import type { CompanyCode } from "../companies";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { clean, iso, type Runner } from "../inventory/service";
import { notify, peopleIn } from "../notify/service";
import { letterheadOf } from "../settings/service";
import type {
  ClearanceDesk,
  HrDocInput,
  HrDocKind,
  HrDocList,
  HrDocPage,
  HrDocRow,
  HrDocStatus,
  Me,
  MyDocuments,
} from "../types";
import { hrEvent } from "./events";
import { HR_ROLES, HR_WRITE_ROLES } from "./people";
import { dayWords, momentDay, type Signer, signed } from "./print";

export const DOC_KINDS: HrDocKind[] = ["coe", "coe_pay", "clearance", "memo", "nte"];
export const DOC_TITLES: Record<HrDocKind, string> = {
  coe: "Certificate of Employment",
  coe_pay: "Certificate of Employment and Compensation",
  clearance: "Clearance",
  memo: "Memorandum",
  nte: "Notice to Explain",
};
/** Each kind's number: its letters, the year, five digits. Both certificates share one series. */
const PREFIX: Record<HrDocKind, string> = { coe: "COE", coe_pay: "COE", clearance: "CLR", memo: "MEMO", nte: "NTE" };
export const DESKS: ClearanceDesk[] = ["lead", "finance", "inventory", "admin", "hr"];
export const DESK_WORDS: Record<ClearanceDesk, string> = {
  lead: "Immediate superior",
  finance: "Finance",
  inventory: "Inventory",
  admin: "Admin (logins and equipment)",
  hr: "Human Resources",
};
/** Who signs a desk's part, by role (the lead's part: whom the person reports to). */
const DESK_ROLE: Record<Exclude<ClearanceDesk, "lead">, string> = {
  finance: "finance",
  inventory: "inventory",
  admin: "admin",
  hr: "hr",
};
/** How long a notice to explain gives, at most, and by default (the usual five days). */
export const NTE_DAYS_MAX = 30;
export const NTE_DAYS = 5;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The next number of a series, kept in `counter` (one row per letters and year). */
async function nextCode(tx: Runner, prefix: string, year: string): Promise<string> {
  const [next] = await rows<{ value: number }>(
    tx,
    sql`insert into counter (name, value) values (${`hrdoc:${prefix}:${year}`}, 1)
      on conflict (name) do update set value = counter.value + 1 returning value::int as value`,
  );
  return `${prefix}-${year}-${String(next?.value ?? 1).padStart(5, "0")}`;
}

type Content = {
  name: string;
  employeeCode: string | null;
  position: string | null;
  department: string | null;
  classification: string;
  hireDate: string;
  leftOn: string | null;
  salary: number | null;
  allowance: number | null;
};

type DocRecord = {
  id: number;
  code: string;
  kind: HrDocKind;
  personId: number;
  name: string;
  employeeCode: string | null;
  company: CompanyCode;
  subject: string | null;
  body: string | null;
  replyBy: string | null;
  content: Content;
  issuedById: number;
  issuedBy: string;
  issuedAt: string;
  acknowledgedAt: string | null;
  reply: string | null;
  repliedAt: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  reportsTo: number | null;
  signs: { desk: ClearanceDesk; signedById: number | null; signedBy: string | null; signedAt: string | null; note: string | null }[] | null;
};

const DOC_COLUMNS = sql`d.id::int as id, d.code, d.kind, d.person_id::int as "personId", p.name,
  e.employee_code as "employeeCode", d.company, d.subject, d.body, to_char(d.reply_by, 'YYYY-MM-DD') as "replyBy",
  d.content, d.issued_by::int as "issuedById", i.name as "issuedBy", ${iso("d.issued_at")} as "issuedAt",
  ${iso("d.acknowledged_at")} as "acknowledgedAt", d.reply, ${iso("d.replied_at")} as "repliedAt",
  ${iso("d.voided_at")} as "voidedAt", v.name as "voidedBy", d.void_reason as "voidReason",
  p.reports_to::int as "reportsTo",
  case when d.kind = 'clearance' then (
    select json_agg(json_build_object('desk', s.desk, 'signedById', s.signed_by, 'signedBy', sp.name,
      'signedAt', to_char(s.signed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'note', s.note)
      order by array_position(array['lead', 'finance', 'inventory', 'admin', 'hr'], s.desk))
    from hr_clearance_sign s left join person sp on sp.id = s.signed_by where s.document_id = d.id) end as signs`;
const DOC_FROM = sql`hr_document d join person p on p.id = d.person_id left join employee e on e.person_id = p.id
  join person i on i.id = d.issued_by left join person v on v.id = d.voided_by`;

/** The desks of a clearance still to sign, in order (HR's only once the others signed). */
const waitingDesks = (doc: DocRecord) => (doc.signs ?? []).filter((one) => !one.signedAt).map((one) => one.desk);

function statusOf(doc: DocRecord): { status: HrDocStatus; words: string } {
  if (doc.voidedAt) return { status: "void", words: `Void: ${doc.voidReason ?? ""}`.trim() };
  if (doc.kind === "clearance") {
    const waiting = waitingDesks(doc);
    return waiting.length
      ? { status: "waiting", words: `Waiting for ${waiting.map((desk) => DESK_WORDS[desk].replace(/ \(.*\)$/, "")).join(", ")}` }
      : { status: "cleared", words: "Cleared" };
  }
  if (doc.kind === "nte" && doc.repliedAt) return { status: "answered", words: `Answered ${momentDay(doc.repliedAt)}` };
  if (doc.kind === "memo" || doc.kind === "nte")
    return doc.acknowledgedAt
      ? { status: "received", words: `Received ${momentDay(doc.acknowledgedAt)}${doc.kind === "nte" ? ", not answered yet" : ""}` }
      : { status: "waiting", words: `Waiting for ${doc.name} to acknowledge` };
  return { status: "issued", words: "Issued" };
}

const rowOf = (doc: DocRecord): HrDocRow => {
  const { status, words } = statusOf(doc);
  return {
    id: doc.id,
    code: doc.code,
    kind: doc.kind,
    title: DOC_TITLES[doc.kind],
    personId: doc.personId,
    name: doc.name,
    employeeCode: doc.employeeCode,
    company: doc.company,
    subject: doc.subject,
    issuedAt: doc.issuedAt,
    issuedBy: doc.issuedBy,
    status,
    statusWords: words,
  };
};

/** The desks of a clearance this person may sign now. */
function desksFor(me: Me, doc: DocRecord): ClearanceDesk[] {
  if (doc.kind !== "clearance" || doc.voidedAt || me.viewedBy) return [];
  const waiting = waitingDesks(doc);
  return waiting.filter((desk) => {
    if (desk === "hr" && waiting.length > 1) return false;
    if (desk === "lead") return doc.reportsTo === me.id;
    return me.role === DESK_ROLE[desk];
  });
}

/** Whether this person may read the paper: HR, the CEO, the Admin, the person, a clearance's signers. */
function mayRead(me: Me, doc: DocRecord): boolean {
  if (HR_ROLES.includes(me.role) || doc.personId === me.id) return true;
  if (doc.kind !== "clearance") return false;
  return doc.reportsTo === me.id || ["finance", "inventory"].includes(me.role);
}

async function load(db: Runner, id: number): Promise<DocRecord> {
  const [doc] = await rows<DocRecord>(db, sql`select ${DOC_COLUMNS} from ${DOC_FROM} where d.id = ${id}`);
  if (!doc) throw new Refusal(404, "not_found", "No such document.");
  return doc;
}

const pesos = (centavos: number) =>
  `₱${(centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const CLASS_WORDS: Record<string, string> = {
  regular: "a regular employee",
  probationary: "a probationary employee",
  part_time: "a part-time employee",
  intern: "an intern",
};

/** The letter of a certificate, from what it kept the day it was issued, in the name of the company
 *  that employs them: the company itself (its Company details; one company per database). */
function certificate(doc: DocRecord, company: string): string[] {
  const c = doc.content;
  const role = c.position ? `as ${c.position}` : "";
  const out = [
    "TO WHOM IT MAY CONCERN:",
    c.leftOn
      ? `This is to certify that ${c.name} was employed by ${company} ${role} from ${dayWords(c.hireDate).replace(/^\w+, /, "")} to ${dayWords(c.leftOn).replace(/^\w+, /, "")}.`
      : `This is to certify that ${c.name} has been employed by ${company} ${role} since ${dayWords(c.hireDate).replace(/^\w+, /, "")}, and is ${CLASS_WORDS[c.classification] ?? "an employee"} to date.`,
  ];
  if (doc.kind === "coe_pay")
    out.push(
      `${c.leftOn ? "At the end of their employment" : "As of the date of this certificate"}, ${c.name} ${c.leftOn ? "received" : "receives"} a monthly basic salary of ${c.salary === null ? "(not on record)" : pesos(c.salary)}${c.allowance ? ` and a monthly allowance of ${pesos(c.allowance)}` : ""}.`,
    );
  out.push(
    `This certification is issued upon the request of ${c.name} for ${doc.subject ?? "whatever legal purpose it may serve"}.`,
    `Issued on ${momentDay(doc.issuedAt)}.`,
  );
  return out.map((one) => one.replace(/ {2,}/g, " "));
}

/** One paper as it prints, with what this person may do on it. */
export async function documentPage(db: Database, me: Me, id: number): Promise<HrDocPage> {
  const doc = await load(db, id);
  if (!mayRead(me, doc)) throw new Refusal(403, "not_allowed", "That document isn't yours to open.");
  const { status, words } = statusOf(doc);
  const issuer: Signer = { box: "Human Resources", id: doc.issuedById, name: doc.issuedBy, at: doc.issuedAt };
  const receiver: Signer = { box: "Received by", id: doc.personId, name: doc.name, at: doc.acknowledgedAt };
  const fields: HrDocPage["fields"] = [];
  let paragraphs: string[] = [];
  let signers: Signer[] = [issuer];
  const letterhead = await letterheadOf(db);
  if (doc.kind === "coe" || doc.kind === "coe_pay") paragraphs = certificate(doc, letterhead.name);
  else if (doc.kind === "memo" || doc.kind === "nte") {
    fields.push(
      { label: "To", value: `${doc.name}${doc.content.position ? `, ${doc.content.position}` : ""}` },
      { label: "From", value: `${doc.issuedBy}, Human Resources` },
      { label: "Date", value: momentDay(doc.issuedAt) },
      { label: "Subject", value: doc.subject ?? "" },
    );
    paragraphs = (doc.body ?? "").split(/\n\s*\n/).map((one) => one.trim()).filter(Boolean);
    if (doc.kind === "nte" && doc.replyBy)
      paragraphs.push(
        `You are asked to explain in writing, on or before ${dayWords(doc.replyBy)}, why no disciplinary action should be taken against you. Not answering by then means you chose not to explain, and the company will decide on what it has.`,
      );
    signers = [{ ...issuer, box: "Issued by" }, receiver];
  } else {
    const c = doc.content;
    paragraphs = [
      `${c.name}${c.position ? `, ${c.position}` : ""}${c.leftOn ? `, last day ${dayWords(c.leftOn).replace(/^\w+, /, "")}` : ""}.`,
      status === "cleared"
        ? "Every desk below has signed: the employee has no accountability left with the company."
        : "Each desk below signs once the employee has nothing left to return or settle with it; a note says what is still owed.",
    ];
    signers = (doc.signs ?? []).map((one) => ({
      box: DESK_WORDS[one.desk],
      id: one.signedById,
      name: one.signedBy,
      at: one.signedAt,
    }));
  }
  const canWrite = HR_WRITE_ROLES.includes(me.role) && !me.viewedBy;
  const own = doc.personId === me.id && !me.viewedBy && !doc.voidedAt;
  return {
    id: doc.id,
    code: doc.code,
    kind: doc.kind,
    title: DOC_TITLES[doc.kind],
    status,
    statusWords: words,
    letterhead,
    person: {
      id: doc.personId,
      name: doc.name,
      employeeCode: doc.content.employeeCode,
      position: doc.content.position,
      department: doc.content.department,
    },
    issuedOn: momentDay(doc.issuedAt),
    issuedBy: doc.issuedBy,
    fields,
    paragraphs,
    replyBy: doc.replyBy,
    reply: doc.reply && doc.repliedAt ? { text: doc.reply, at: doc.repliedAt } : null,
    clearance: doc.signs
      ? doc.signs.map((one) => ({ desk: one.desk, label: DESK_WORDS[one.desk], signer: one.signedBy, at: one.signedAt, note: one.note }))
      : null,
    signers: await signed(db, signers),
    void: doc.voidedAt ? { at: doc.voidedAt, by: doc.voidedBy ?? "", reason: doc.voidReason ?? "" } : null,
    can: {
      void: canWrite && !doc.voidedAt,
      acknowledge: own && (doc.kind === "memo" || doc.kind === "nte") && !doc.acknowledgedAt,
      reply: own && doc.kind === "nte" && !doc.repliedAt,
      sign: desksFor(me, doc),
    },
  };
}

/** HR's list of papers, newest first: by person, kind or words (a name, a number, a subject). */
export async function documentList(
  db: Database,
  me: Me,
  asked: { person?: number | null; kind?: string | null; q?: string | null } = {},
): Promise<HrDocList> {
  allow(me, HR_ROLES, "see HR's documents");
  const kind = DOC_KINDS.includes(asked.kind as HrDocKind) ? (asked.kind as HrDocKind) : null;
  const q = clean(asked.q)?.slice(0, 60);
  const like = q ? `%${q.replace(/[%_\\]/g, "\\$&")}%` : null;
  const found = await rows<DocRecord>(
    db,
    sql`select ${DOC_COLUMNS} from ${DOC_FROM}
      where true ${asked.person ? sql`and d.person_id = ${asked.person}` : sql``}
        ${kind ? sql`and d.kind = ${kind}` : sql``}
        ${like ? sql`and (p.name ilike ${like} or d.code ilike ${like} or d.subject ilike ${like} or e.employee_code ilike ${like})` : sql``}
      order by d.issued_at desc, d.id desc limit 300`,
  );
  const [person] = asked.person
    ? await rows<NonNullable<HrDocList["person"]>>(
        db,
        sql`select p.id::int as id, p.name, e.employee_code as "employeeCode", coalesce(e.position, p.title) as position,
            e.company, p.active from person p join employee e on e.person_id = p.id where p.id = ${asked.person}`,
      )
    : [];
  if (asked.person && !person) throw new Refusal(404, "not_found", "No one with an HR record by that link.");
  return {
    rows: found.map(rowOf),
    person: person ?? null,
    kinds: DOC_KINDS.map((key) => ({ key, label: DOC_TITLES[key] })),
    can: { issue: HR_WRITE_ROLES.includes(me.role) && !me.viewedBy },
  };
}

/** A person's own papers, and the clearances waiting for their desk. */
export async function myDocuments(db: Database, me: Me): Promise<MyDocuments> {
  const [own, open] = await Promise.all([
    rows<DocRecord>(db, sql`select ${DOC_COLUMNS} from ${DOC_FROM} where d.person_id = ${me.id} order by d.issued_at desc limit 200`),
    rows<DocRecord>(
      db,
      sql`select ${DOC_COLUMNS} from ${DOC_FROM} where d.kind = 'clearance' and d.voided_at is null
        and exists (select 1 from hr_clearance_sign s where s.document_id = d.id and s.signed_at is null)
        order by d.issued_at limit 200`,
    ),
  ]);
  return { rows: own.map(rowOf), toSign: open.filter((doc) => desksFor(me, doc).length).map(rowOf) };
}

/** HR issues a paper. */
export async function issueDocument(db: Database, me: Me, input: HrDocInput): Promise<{ id: number; code: string }> {
  allow(me, HR_WRITE_ROLES, "issue HR documents");
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
  if (!DOC_KINDS.includes(input.kind)) throw new Refusal(400, "invalid", "Pick the kind of document.", "kind");
  const subject = clean(input.subject);
  const body = clean(input.body);
  const today = todayManila();
  if (input.kind === "coe" || input.kind === "coe_pay") {
    if (!subject) throw new Refusal(400, "invalid", "Say what the certificate is for (a bank loan, a visa…).", "subject");
  } else if (input.kind === "memo" || input.kind === "nte") {
    if (!subject) throw new Refusal(400, "invalid", "Type the subject.", "subject");
    if (!body) throw new Refusal(400, "invalid", "Type what it says.", "body");
  }
  if (subject && subject.length > 200) throw new Refusal(400, "invalid", "Keep it under 200 characters.", "subject");
  if (body && body.length > 8000) throw new Refusal(400, "invalid", "Keep it under 8,000 characters.", "body");
  let replyBy: string | null = null;
  if (input.kind === "nte") {
    replyBy = input.replyBy ?? addDays(today, NTE_DAYS);
    if (!DAY.test(replyBy) || replyBy < today || replyBy > addDays(today, NTE_DAYS_MAX))
      throw new Refusal(400, "invalid", `Pick a day from today to ${NTE_DAYS_MAX} days ahead.`, "replyBy");
  }
  const [person] = await rows<Content & { personId: number; company: CompanyCode; reportsTo: number | null; role: string }>(
    db,
    sql`select p.id::int as "personId", p.name, p.role, p.reports_to::int as "reportsTo", e.employee_code as "employeeCode",
        coalesce(e.position, p.title) as position, e.department, e.classification, e.company,
        to_char(e.hire_date, 'YYYY-MM-DD') as "hireDate", to_char(e.left_on, 'YYYY-MM-DD') as "leftOn", e.salary, e.allowance
      from person p join employee e on e.person_id = p.id where p.id = ${input.personId}`,
  );
  if (!person) throw new Refusal(404, "not_found", "Pick someone with an HR record.", "personId");
  const content: Content = {
    name: person.name,
    employeeCode: person.employeeCode,
    position: person.position,
    department: person.department,
    classification: person.classification,
    hireDate: person.hireDate,
    leftOn: person.leftOn,
    salary: input.kind === "coe_pay" ? person.salary : null,
    allowance: input.kind === "coe_pay" ? person.allowance : null,
  };
  const made = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from person where id = ${person.personId} for update`);
    if (input.kind === "clearance") {
      const [open] = await rows<{ code: string }>(
        tx,
        sql`select code from hr_document where person_id = ${person.personId} and kind = 'clearance' and voided_at is null`,
      );
      if (open) throw new Refusal(409, "taken", `${person.name} has a clearance already (${open.code}).`, "personId");
    }
    const code = await nextCode(tx, PREFIX[input.kind], today.slice(0, 4));
    const [row] = await rows<{ id: number }>(
      tx,
      sql`insert into hr_document (code, kind, person_id, company, subject, body, reply_by, content, issued_by)
        values (${code}, ${input.kind}, ${person.personId}, ${person.company}, ${subject}, ${body},
          ${replyBy}::date, ${JSON.stringify(content)}::jsonb, ${me.id}) returning id::int as id`,
    );
    const id = row?.id as number;
    if (input.kind === "clearance")
      for (const desk of DESKS.filter((one) => one !== "lead" || person.reportsTo !== null))
        await tx.execute(sql`insert into hr_clearance_sign (document_id, desk) values (${id}, ${desk})`);
    await hrEvent(tx, person.personId, me.id, "document", `${DOC_TITLES[input.kind]} ${code} issued${subject ? `: ${subject}` : ""}`);
    return { id, code };
  });
  const link = `/hr/documents/${made.id}`;
  if (input.kind === "memo" || input.kind === "nte")
    await notify(db, {
      to: [person.personId],
      kind: "hr_document",
      title: `${DOC_TITLES[input.kind]} for you: ${subject}`,
      body: input.kind === "nte" && replyBy ? `Explain in writing by ${dayWords(replyBy)}.` : "Open it and acknowledge that you received it.",
      link,
      key: `hr_document:${made.id}:issued`,
    });
  if (input.kind === "clearance") {
    const signers = await peopleIn(db, ["finance", "inventory", "admin"]);
    await notify(db, {
      to: [...signers, ...(person.reportsTo ? [person.reportsTo] : [])],
      kind: "hr_document",
      title: `Clearance for ${person.name}: sign your part`,
      body: "Sign once they have nothing left to return or settle with your desk; note what is still owed.",
      link,
      key: `hr_document:${made.id}:clearance`,
    });
  }
  return made;
}

/** HR voids a wrong paper, saying why (it stays, marked void). */
export async function voidDocument(db: Database, me: Me, id: number, reason: string | null | undefined): Promise<void> {
  allow(me, HR_WRITE_ROLES, "void HR documents");
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
  const why = clean(reason);
  if (!why) throw new Refusal(400, "invalid", "Say why it is void.", "reason");
  if (why.length > 300) throw new Refusal(400, "invalid", "Keep it under 300 characters.", "reason");
  await db.transaction(async (tx) => {
    const [done] = await rows<{ personId: number; code: string }>(
      tx,
      sql`update hr_document set voided_at = now(), voided_by = ${me.id}, void_reason = ${why}
        where id = ${id} and voided_at is null returning person_id::int as "personId", code`,
    );
    if (!done) throw new Refusal(409, "invalid", "That document is void already, or isn't there.");
    await hrEvent(tx, done.personId, me.id, "document", `${done.code} voided: ${why}`);
  });
}

/** The person acknowledges a memo or a notice (and may answer the notice in the same step). */
export async function acknowledgeDocument(db: Database, me: Me, id: number, answer?: string | null): Promise<void> {
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
  const doc = await load(db, id);
  if (doc.personId !== me.id) throw new Refusal(403, "not_allowed", "Only the person it is for acknowledges it.");
  if (doc.voidedAt) throw new Refusal(409, "invalid", "That document is void.");
  if (doc.kind !== "memo" && doc.kind !== "nte") throw new Refusal(409, "invalid", "Only a memo or a notice is acknowledged.");
  const reply = clean(answer);
  if (reply && doc.kind !== "nte") throw new Refusal(400, "invalid", "Only a notice to explain is answered.", "reply");
  if (reply && doc.repliedAt) throw new Refusal(409, "invalid", "You answered it already.", "reply");
  if (reply && reply.length > 8000) throw new Refusal(400, "invalid", "Keep it under 8,000 characters.", "reply");
  if (!reply && doc.acknowledgedAt) throw new Refusal(409, "invalid", "You acknowledged it already.");
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`update hr_document set acknowledged_at = coalesce(acknowledged_at, now())
        ${reply ? sql`, reply = ${reply}, replied_at = now()` : sql``} where id = ${id}`,
    );
    await hrEvent(tx, doc.personId, me.id, "document", `${doc.code} ${reply ? "answered" : "acknowledged"}`);
  });
  if (reply)
    await notify(db, {
      to: [doc.issuedById],
      kind: "hr_document",
      title: `${doc.name} answered ${doc.code}`,
      link: `/hr/documents/${id}`,
      key: `hr_document:${id}:answered`,
    });
}

/** A desk signs its part of a clearance, with a note of anything still owed. */
export async function signClearance(
  db: Database,
  me: Me,
  id: number,
  input: { desk: ClearanceDesk; note?: string | null },
): Promise<void> {
  const doc = await load(db, id);
  if (!mayRead(me, doc) && !desksFor(me, doc).length) throw new Refusal(403, "not_allowed", "That clearance isn't yours to sign.");
  if (!desksFor(me, doc).includes(input.desk))
    throw new Refusal(
      403,
      "not_allowed",
      input.desk === "hr" && waitingDesks(doc).length > 1
        ? "HR signs last, once every other desk has."
        : `That part is ${DESK_WORDS[input.desk]}'s to sign.`,
      "desk",
    );
  const note = clean(input.note);
  if (note && note.length > 500) throw new Refusal(400, "invalid", "Keep the note under 500 characters.", "note");
  const left = await db.transaction(async (tx) => {
    const done = await rows<{ id: number }>(
      tx,
      sql`update hr_clearance_sign set signed_by = ${me.id}, signed_at = now(), note = ${note}
        where document_id = ${id} and desk = ${input.desk} and signed_at is null returning id::int as id`,
    );
    if (!done.length) throw new Refusal(409, "invalid", "That part is signed already.");
    await hrEvent(tx, doc.personId, me.id, "document", `${doc.code}: ${DESK_WORDS[input.desk]} signed${note ? ` (${note})` : ""}`);
    const [open] = await rows<{ n: number }>(
      tx,
      sql`select count(*)::int as n from hr_clearance_sign where document_id = ${id} and signed_at is null`,
    );
    return open?.n ?? 0;
  });
  // Every desk but HR signed: HR's turn. All signed: the person is cleared.
  if (left === 1)
    await notify(db, {
      to: await peopleIn(db, ["hr"]),
      kind: "hr_document",
      title: `Clearance for ${doc.name}: every desk signed, HR's turn`,
      link: `/hr/documents/${id}`,
      key: `hr_document:${id}:hr_turn`,
    });
}
