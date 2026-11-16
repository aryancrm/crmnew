// Government tenders (docs/PLAN.md 16.6, RA 12009 and its 2025 rules): from the PhilGEPS posting to
// the payment. Steps go Found → Preparing → Price approved (the Government Bidding Admin) →
// Submitted → Won / Lost → Contract (NTP) → Delivered → Accepted (IAR) → Billed → Paid, or Dropped
// before submission with its reason. Every move is kept. The bidding line (its Admin, coachees and
// CHC), the Sales and Marketing Mentor, the CEO and the Admin see every tender; anyone else only
// the tenders they run. The company's eligibility papers are kept with their expiry.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { inForce } from "../org/service";
import type { CompanyPaper, Me, Tender, TenderDesk, TenderInput, TenderStep } from "../types";

export const STEPS: TenderStep[] = ["found", "preparing", "price_approved", "submitted", "won", "lost", "contract", "delivered", "accepted", "billed", "paid", "dropped"];
/** Where each step may go next. */
const NEXT: Record<TenderStep, TenderStep[]> = {
  found: ["preparing", "dropped"],
  preparing: ["price_approved", "dropped"],
  price_approved: ["submitted", "preparing", "dropped"],
  submitted: ["won", "lost"],
  won: ["contract"],
  lost: [],
  contract: ["delivered"],
  delivered: ["accepted"],
  accepted: ["billed"],
  billed: ["paid"],
  paid: [],
  dropped: [],
};
/** The envelope papers a medicine tender asks for (RA 12009 rules, the bidding documents). */
export const ENVELOPE = [
  "PhilGEPS Platinum certificate",
  "Omnibus Sworn Statement",
  "Bid security (or Bid Securing Declaration)",
  "Technical specifications and Certificate of Availability of Stocks",
  "FDA LTO",
  "CPR of each medicine",
  "NFCC or committed line of credit",
  "Statement of ongoing and completed contracts (SLCC)",
];

const isAdmin = (me: Me) => (me.role === "team_lead" && me.channel?.code === "BID") || me.role === "admin";
const seesAll = (me: Me) =>
  ["ceo", "admin"].includes(me.role) || me.channel?.code === "BID" || (me.role === "manager" && me.business === "B2B");
const scope = (me: Me): SQL => (seesAll(me) ? sql`true` : sql`t.owner_id = ${me.id}`);

const tenderSelect = sql`select t.id::int as id, t.code, t.title, t.agency_id::int as "agencyId", c.name as agency, t.philgeps_ref as "philgepsRef",
    t.mode, t.abc::float8 as abc, t.owner_id::int as "ownerId", o.name as owner, t.step,
    to_char(t.posted_on, 'YYYY-MM-DD') as "postedOn", to_char(t.prebid_on, 'YYYY-MM-DD') as "prebidOn",
    t.deadline_at as "deadlineAt", to_char(t.opening_on, 'YYYY-MM-DD') as "openingOn",
    t.our_bid::float8 as "ourBid", t.winning_bid::float8 as "winningBid", t.result_note as "resultNote",
    to_char(t.noa_on, 'YYYY-MM-DD') as "noaOn", to_char(t.ntp_on, 'YYYY-MM-DD') as "ntpOn", to_char(t.deliver_by, 'YYYY-MM-DD') as "deliverBy",
    to_char(t.delivered_on, 'YYYY-MM-DD') as "deliveredOn", to_char(t.accepted_on, 'YYYY-MM-DD') as "acceptedOn",
    to_char(t.billed_on, 'YYYY-MM-DD') as "billedOn", to_char(t.paid_on, 'YYYY-MM-DD') as "paidOn",
    t.bid_security_form as "bidSecurityForm", t.bid_security_amount::float8 as "bidSecurityAmount",
    to_char(t.bid_security_back_on, 'YYYY-MM-DD') as "bidSecurityBackOn", a.name as "priceApprovedBy",
    t.papers, t.dropped_reason as "droppedReason"
  from tender t join customer c on c.id = t.agency_id join person o on o.id = t.owner_id left join person a on a.id = t.price_approved_by`;

export async function listTenders(db: Database, me: Me): Promise<Tender[]> {
  return rows<Tender>(db, sql`${tenderSelect} where ${scope(me)} order by t.deadline_at nulls last, t.id desc limit 300`);
}

export async function tenderDetail(db: Database, me: Me, id: number) {
  const [tender] = await rows<Tender>(db, sql`${tenderSelect} where t.id = ${id} and ${scope(me)}`);
  if (!tender) throw new Refusal(404, "not_found", "No such tender (or it is not yours to see).");
  const [lines, events] = await Promise.all([
    rows<{ id: number; medicineId: number; medicine: string; qty: number; unitPrice: number }>(
      db,
      sql`select l.id::int as id, l.medicine_id::int as "medicineId", m.name || coalesce(' ' || m.strength, '') as medicine, l.qty, l.unit_price as "unitPrice"
        from tender_line l join medicine m on m.id = l.medicine_id where l.tender_id = ${id} and l.replaced_at is null order by l.id`,
    ),
    rows<{ step: string; note: string | null; by: string; at: string }>(
      db,
      sql`select e.step, e.note, p.name as by, e.at from tender_event e join person p on p.id = e.by_person where e.tender_id = ${id} order by e.at`,
    ),
  ]);
  return { tender, lines, events, next: NEXT[tender.step], canApprove: isAdmin(me) };
}

export async function createTender(db: Database, me: Me, input: TenderInput): Promise<{ id: number }> {
  if (!seesAll(me) && !(me.role === "medrep" && /bidding/i.test(me.title ?? "")))
    throw new Refusal(403, "not_allowed", "The bidding team (or a government bidding coachee) records tenders.");
  const [agency] = await rows<{ kind: string }>(db, sql`select kind from customer where id = ${input.agencyId} and active`);
  if (!agency || !["government", "hospital"].includes(agency.kind))
    throw new Refusal(400, "invalid", "Pick the buying agency or government hospital.", "agencyId");
  const today = todayManila();
  const [seat] = await rows<{ id: number }>(
    db,
    sql`select seat_id::int as id from seat_holder h where h.person_id = ${me.id} and ${inForce("h", today)} order by h.starts_on desc limit 1`,
  );
  const [count] = await rows<{ n: number }>(db, sql`select count(*)::int as n from tender`);
  const code = `TND-${today.slice(0, 4)}-${String((count?.n ?? 0) + 1).padStart(4, "0")}`;
  const papers = JSON.stringify(ENVELOPE.map((paper) => ({ paper, done: false })));
  const [made] = await rows<{ id: number }>(
    db,
    sql`insert into tender (code, agency_id, title, philgeps_ref, mode, abc, owner_id, seat_id, posted_on, prebid_on, deadline_at, opening_on, papers, created_by)
      values (${code}, ${input.agencyId}, ${input.title.trim()}, ${input.philgepsRef?.trim() || null}, ${input.mode}, ${input.abc ?? null},
        ${me.id}, ${seat?.id ?? null}, ${input.postedOn ?? null}::date, ${input.prebidOn ?? null}::date, ${input.deadlineAt ?? null}::timestamptz,
        ${input.openingOn ?? null}::date, ${papers}::jsonb, ${me.id})
      returning id::int as id`,
  );
  await db.execute(sql`insert into tender_event (tender_id, step, note, by_person) values (${made?.id}, 'found', 'Recorded', ${me.id})`);
  return made as { id: number };
}

/** Saves a tender's details: dates, our bid, the security, the award's dates, the papers. */
export async function saveTender(db: Database, me: Me, id: number, input: Partial<Tender>): Promise<void> {
  await tenderDetail(db, me, id);
  const papers = input.papers ? JSON.stringify(input.papers) : null;
  await db.execute(
    sql`update tender set
        philgeps_ref = coalesce(${input.philgepsRef ?? null}, philgeps_ref),
        abc = coalesce(${input.abc ?? null}, abc),
        prebid_on = coalesce(${input.prebidOn ?? null}::date, prebid_on),
        deadline_at = coalesce(${input.deadlineAt ?? null}::timestamptz, deadline_at),
        opening_on = coalesce(${input.openingOn ?? null}::date, opening_on),
        our_bid = coalesce(${input.ourBid ?? null}, our_bid),
        bid_security_form = coalesce(${input.bidSecurityForm ?? null}, bid_security_form),
        bid_security_amount = coalesce(${input.bidSecurityAmount ?? null}, bid_security_amount),
        bid_security_back_on = coalesce(${input.bidSecurityBackOn ?? null}::date, bid_security_back_on),
        deliver_by = coalesce(${input.deliverBy ?? null}::date, deliver_by),
        papers = coalesce(${papers}::jsonb, papers),
        updated_at = now()
      where id = ${id}`,
  );
}

export async function setLines(db: Database, me: Me, id: number, lines: { medicineId: number; qty: number; unitPrice: number }[]): Promise<void> {
  const { tender } = await tenderDetail(db, me, id);
  if (!["found", "preparing"].includes(tender.step)) throw new Refusal(409, "locked", "The bid price is set before the price is approved.");
  await db.transaction(async (tx) => {
    // The earlier lines are kept, marked replaced.
    await tx.execute(sql`update tender_line set replaced_at = now() where tender_id = ${id} and replaced_at is null`);
    for (const line of lines)
      await tx.execute(sql`insert into tender_line (tender_id, medicine_id, qty, unit_price) values (${id}, ${line.medicineId}, ${line.qty}, ${line.unitPrice})`);
    const total = lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0);
    await tx.execute(sql`update tender set our_bid = ${total}, updated_at = now() where id = ${id}`);
  });
}

/** Moves a tender to its next step, with what that step needs. */
export async function moveTender(
  db: Database,
  me: Me,
  id: number,
  input: { step: TenderStep; note?: string | null; on?: string | null; winningBid?: number | null },
): Promise<void> {
  const { tender } = await tenderDetail(db, me, id);
  if (!NEXT[tender.step].includes(input.step)) throw new Refusal(409, "invalid_step", `A tender ${tender.step.replace("_", " ")} cannot go to ${input.step.replace("_", " ")}.`);
  const day = input.on ?? todayManila();
  const set: SQL[] = [sql`step = ${input.step}`, sql`updated_at = now()`];
  if (input.step === "price_approved") {
    if (!isAdmin(me)) throw new Refusal(403, "not_allowed", "The Government Bidding Admin approves the bid price.");
    if (!tender.ourBid) throw new Refusal(400, "invalid", "Put the bid price (the medicines and their prices) first.");
    if (tender.abc && tender.ourBid > tender.abc) throw new Refusal(400, "invalid", "Our bid is above the ABC: it would be rejected.");
    set.push(sql`price_approved_by = ${me.id}`);
  }
  if (input.step === "submitted") {
    const missing = tender.papers.filter((p) => !p.done).map((p) => p.paper);
    if (missing.length) throw new Refusal(400, "papers", `The envelope is not complete: ${missing.join(", ")}.`);
  }
  if (input.step === "lost" && !input.winningBid && !input.note) throw new Refusal(400, "invalid", "Write the winning bid or why we lost.", "note");
  if (input.step === "lost") set.push(sql`winning_bid = ${input.winningBid ?? null}, result_note = ${input.note ?? null}`);
  if (input.step === "won") set.push(sql`noa_on = ${day}::date, result_note = ${input.note ?? null}`);
  if (input.step === "contract") set.push(sql`ntp_on = ${day}::date`);
  if (input.step === "delivered") set.push(sql`delivered_on = ${day}::date`);
  if (input.step === "accepted") set.push(sql`accepted_on = ${day}::date`);
  if (input.step === "billed") set.push(sql`billed_on = ${day}::date`);
  if (input.step === "paid") set.push(sql`paid_on = ${day}::date`);
  if (input.step === "dropped") {
    if (!input.note?.trim()) throw new Refusal(400, "invalid", "Say why the tender is not pursued.", "note");
    set.push(sql`dropped_reason = ${input.note}`);
  }
  await db.execute(sql`update tender set ${sql.join(set, sql`, `)} where id = ${id}`);
  await db.execute(sql`insert into tender_event (tender_id, step, note, by_person) values (${id}, ${input.step}, ${input.note ?? null}, ${me.id})`);
}

export async function tenderDesk(db: Database, me: Me): Promise<TenderDesk> {
  const today = todayManila();
  const all = await listTenders(db, me);
  const week = `${addDays(today, 7)}T23:59:59+08:00`;
  const open = all.filter((t) => ["found", "preparing", "price_approved"].includes(t.step));
  const month = today.slice(0, 7);
  const results = all.filter((t) => (t.step === "lost" || t.noaOn) && ((t.noaOn ?? "").startsWith(month) || t.step === "lost"));
  const won = all.filter((t) => t.noaOn?.startsWith(month));
  const lost = all.filter((t) => t.step === "lost");
  const papers = await companyPapers(db);
  return {
    today,
    deadlines: open.filter((t) => t.deadlineAt && t.deadlineAt <= week),
    toApprove: all.filter((t) => t.step === "preparing" && t.ourBid),
    awaiting: all.filter((t) => t.step === "submitted"),
    toDeliver: all.filter((t) => t.step === "won" || t.step === "contract"),
    toAccept: all.filter((t) => t.step === "delivered"),
    toBill: all.filter((t) => t.step === "accepted"),
    toCollect: all.filter((t) => t.step === "billed"),
    month: {
      won: won.length,
      lost: lost.length,
      winRate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
      wonValue: won.reduce((sum, t) => sum + (t.ourBid ?? 0), 0),
    },
    resultsCount: results.length,
    papersEnding: papers.filter((p) => p.state !== "valid"),
    canApprove: isAdmin(me),
  };
}

export async function companyPapers(db: Database): Promise<CompanyPaper[]> {
  const today = todayManila();
  const found = await rows<Omit<CompanyPaper, "state">>(
    db,
    sql`select p.id::int as id, p.name, p.number, to_char(p.expires_on, 'YYYY-MM-DD') as "expiresOn", p.note,
        (p.expires_on - ${today}::date)::int as "daysLeft"
      from company_paper p
      where not exists (select 1 from company_paper n where lower(n.name) = lower(p.name) and n.id > p.id)
      order by p.expires_on nulls last, p.name`,
  );
  return found.map((p) => ({ ...p, state: p.daysLeft === null ? "valid" : p.daysLeft < 0 ? "expired" : p.daysLeft <= 60 ? "expiring" : "valid" }));
}

export async function addCompanyPaper(db: Database, me: Me, input: { name: string; number?: string | null; expiresOn?: string | null; note?: string | null }): Promise<void> {
  if (!isAdmin(me) && !["ceo", "admin"].includes(me.role)) throw new Refusal(403, "not_allowed", "The Government Bidding Admin keeps the company's papers.");
  await db.execute(
    sql`insert into company_paper (name, number, expires_on, note, added_by)
      values (${input.name.trim()}, ${input.number?.trim() || null}, ${input.expiresOn || null}::date, ${input.note?.trim() || null}, ${me.id})`,
  );
}
