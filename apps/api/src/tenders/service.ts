// Government tenders (docs/PLAN.md 16.6, RA 12009 and its 2025 rules): from the PhilGEPS posting to
// the payment. Steps go Found → Preparing → Price approved (the Government Bidding Admin) →
// Submitted → Won / Lost → Contract (NTP) → Delivered → Accepted (IAR) → Billed → Paid, or Dropped
// before submission with its reason. Every move is kept. The bidding line (its Admin, coachees and
// CHC), the Sales and Marketing Mentor, the CEO and the Admin see every tender; anyone else only
// the tenders they run. The company's eligibility papers are kept with their expiry.

import { type SQL, sql } from "drizzle-orm";
import { peopleUnder, seatsUnder } from "../org/scope";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { inForce } from "../org/service";
import type { BidReport, CompanyPaper, Me, Tender, TenderBidder, TenderDesk, TenderInput, TenderReason, TenderStanding, TenderStep } from "../types";

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

/** Who approves a bid price: whoever leads a Government Bidding box on the Company tree (the target
 *  sheet's BID manager: Subir; Aryan, 20 Nov: "the sheet is the master, the tree decides"), and the
 *  Admin. It was the seat's work and channel (a team lead in BID), which a seat leading nobody could
 *  carry. */
async function approvesBids(db: Database, me: Me): Promise<boolean> {
  if (me.role === "admin") return true;
  const [found] = await rows<{ ok: boolean }>(
    db,
    sql`select exists (select 1 from seat_holder h join seat s on s.id = h.seat_id and s.active and s.lead
      where h.person_id = ${me.id} and h.starts_on <= (now() at time zone 'Asia/Manila')::date and (h.ends_on is null or h.ends_on >= (now() at time zone 'Asia/Manila')::date)
        and unit_division(s.unit_id) = 'BID') as ok`,
  );
  return found?.ok === true;
}
export const seesAll = (me: Me) =>
  ["ceo", "admin"].includes(me.role) || me.channel?.code === "BID" || (me.role === "manager" && me.business === "B2B");
// Anyone else sees the tenders they run; a head (the Hospital Division's Business Mentor, say)
// also those run from their own business (the Government Account's).
const scope = (me: Me): SQL => {
  const own = seesAll(me)
    ? sql`true`
    : me.role === "manager" && me.business
      ? sql`(t.owner_id = ${me.id} or seat_business_channel(t.seat_id) = ${me.business})`
      : sql`t.owner_id = ${me.id}`;
  // One box picked on a lead's page (?unit=): the tenders run from it.
  return me.unit
    ? sql`(${own}) and (t.seat_id in ${seatsUnder(me.unit)} or t.owner_id in ${peopleUnder(me.unit)})`
    : own;
};

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
    t.papers, t.dropped_reason as "droppedReason", c.city as "agencyCity",
    t.result_reason as "resultReason", to_char(t.result_on, 'YYYY-MM-DD') as "resultOn",
    t.performance_security_form as "performanceSecurityForm", t.performance_security_amount::float8 as "performanceSecurityAmount",
    to_char(t.performance_security_back_on, 'YYYY-MM-DD') as "performanceSecurityBackOn",
    t.retention_amount::float8 as "retentionAmount", to_char(t.retention_back_on, 'YYYY-MM-DD') as "retentionBackOn"
  from tender t join customer c on c.id = t.agency_id join person o on o.id = t.owner_id left join person a on a.id = t.price_approved_by`;

export async function listTenders(db: Database, me: Me): Promise<Tender[]> {
  return rows<Tender>(db, sql`${tenderSelect} where ${scope(me)} order by t.deadline_at nulls last, t.id desc limit 300`);
}

export async function tenderDetail(db: Database, me: Me, id: number) {
  const [tender] = await rows<Tender>(db, sql`${tenderSelect} where t.id = ${id} and ${scope(me)}`);
  if (!tender) throw new Refusal(404, "not_found", "No such tender (or it is not yours to see).");
  const [lines, events, bidders] = await Promise.all([
    rows<{ id: number; medicineId: number; medicine: string; qty: number; unitPrice: number }>(
      db,
      sql`select l.id::int as id, l.medicine_id::int as "medicineId", m.name || coalesce(' ' || m.strength, '') as medicine, l.qty, l.unit_price as "unitPrice"
        from tender_line l join medicine m on m.id = l.medicine_id where l.tender_id = ${id} and l.replaced_at is null order by l.id`,
    ),
    rows<{ step: string; note: string | null; by: string; at: string }>(
      db,
      sql`select e.step, e.note, p.name as by, e.at from tender_event e join person p on p.id = e.by_person where e.tender_id = ${id} order by e.at`,
    ),
    biddersOf(db, [id]),
  ]);
  // The notice it came from in the tender finder, with what it asked line by line.
  const [found] = await rows<{ id: number; source: string; refNo: string; link: string | null }>(
    db,
    sql`select id::int as id, source, ref_no as "refNo", link from tender_found where tender_id = ${id}`,
  );
  const asked = found
    ? await rows<{ id: number; description: string; qty: number | null; unit: string | null; abcUnit: number | null; medicineId: number | null }>(
        db,
        sql`select id::int as id, description, qty::float8 as qty, unit, abc_unit::float8 as "abcUnit", medicine_id::int as "medicineId"
          from tender_found_line where found_id = ${found.id} and replaced_at is null order by position`,
      )
    : [];
  return {
    tender,
    lines,
    events,
    found: found ? { ...found, asked } : null,
    next: NEXT[tender.step],
    canApprove: await approvesBids(db, me),
    bidders,
    standing: standingOf(tender, bidders),
    canBidders: OPENED.includes(tender.step),
  };
}

/** The steps after the opening, when the bids read can be written down. */
const OPENED: TenderStep[] = ["submitted", "won", "lost", "contract", "delivered", "accepted", "billed", "paid"];
const REASONS: TenderReason[] = ["lowest", "lower_price", "above_abc", "documents", "post_disqualified", "failed_bidding", "other"];

/** The bidders read at the opening of these tenders (the rows put right left out). */
async function biddersOf(db: Database, tenderIds: number[]): Promise<(TenderBidder & { tenderId: number })[]> {
  if (!tenderIds.length) return [];
  return rows<TenderBidder & { tenderId: number }>(
    db,
    sql`select b.id::int as id, b.tender_id::int as "tenderId", b.name, b.price::float8 as price, b.lines, b.disqualified, b.note,
        p.name as by, b.at
      from tender_bidder b join person p on p.id = b.by_person
      where b.tender_id in (${sql.join(tenderIds.map((one) => sql`${one}`), sql`, `)}) and b.replaced_at is null
      order by b.price nulls last, b.id`,
  );
}

/** Where our bid stood: every price read (ours too), the lowest not disqualified, our place. */
function standingOf(tender: Pick<Tender, "ourBid">, bidders: TenderBidder[]): TenderStanding {
  const bids = [
    ...(tender.ourBid !== null ? [{ name: "2MG (us)", price: tender.ourBid, us: true, disqualified: false }] : []),
    ...bidders.filter((one) => one.price !== null).map((one) => ({ name: one.name, price: one.price as number, us: false, disqualified: one.disqualified })),
  ].sort((a, b) => a.price - b.price || Number(b.us) - Number(a.us));
  const standing = bids.filter((one) => !one.disqualified);
  const lowest = standing[0] ?? null;
  const at = standing.findIndex((one) => one.us);
  const ours = tender.ourBid;
  const gap = lowest && ours !== null && !lowest.us ? ours - lowest.price : null;
  return {
    bids,
    lowest: lowest ? { name: lowest.name, price: lowest.price, us: lowest.us } : null,
    rank: at >= 0 && bidders.length ? at + 1 : null,
    gap,
    gapPct: gap !== null && lowest && lowest.price > 0 ? Math.round((gap / lowest.price) * 1000) / 10 : null,
  };
}

/** A bidder read at the opening, written down (or put right: the old row is kept, replaced). */
export async function saveBidder(
  db: Database,
  me: Me,
  tenderId: number,
  input: { name: string; price?: number | null; lines?: { medicineId: number; unitPrice: number }[]; disqualified?: boolean; note?: string | null },
  replacing?: number,
): Promise<{ id: number }> {
  const { tender } = await tenderDetail(db, me, tenderId);
  if (!OPENED.includes(tender.step))
    throw new Refusal(409, "invalid_step", "The other bids are written once the bids are opened (after Submitted).");
  if (!input.name.trim()) throw new Refusal(400, "invalid", "Name the bidder.", "name");
  if ((input.price === null || input.price === undefined) && !(input.lines ?? []).length)
    throw new Refusal(400, "invalid", "Write their bid: the total, or a price for each medicine.", "price");
  return db.transaction(async (tx) => {
    if (replacing)
      await tx.execute(sql`update tender_bidder set replaced_at = now() where id = ${replacing} and tender_id = ${tenderId} and replaced_at is null`);
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into tender_bidder (tender_id, name, price, lines, disqualified, note, by_person)
        values (${tenderId}, ${input.name.trim()}, ${input.price ?? null}, ${JSON.stringify(input.lines ?? [])}::jsonb,
          ${input.disqualified ?? false}, ${input.note?.trim() || null}, ${me.id})
        returning id::int as id`,
    );
    return made as { id: number };
  });
}

/** A bidder written by mistake: kept, marked replaced, off the report. */
export async function removeBidder(db: Database, me: Me, bidderId: number): Promise<void> {
  const [found] = await rows<{ tenderId: number }>(
    db,
    sql`select tender_id::int as "tenderId" from tender_bidder where id = ${bidderId} and replaced_at is null`,
  );
  if (!found) throw new Refusal(404, "not_found", "No such bidder.");
  await tenderDetail(db, me, found.tenderId);
  await db.execute(sql`update tender_bidder set replaced_at = now() where id = ${bidderId}`);
}

/** Who records tenders (and has the tender finder): the seats that see every tender, and a
 *  government bidding coachee: by their seat's title, or by another seat they hold on the chart
 *  (Reynan leads TeleSales beside his Government Bidding Coachee seat). */
export async function recordsTenders(db: Database, me: Me): Promise<boolean> {
  if (seesAll(me)) return true;
  if (me.role === "medrep" && /bidding/i.test(me.title ?? "")) return true;
  const [found] = await rows<{ ok: boolean }>(
    db,
    sql`select exists (select 1 from seat_holder h join seat s on s.id = h.seat_id and s.active
      where h.person_id = ${me.id} and s.title ~* 'bidding' and h.starts_on <= (now() at time zone 'Asia/Manila')::date
        and (h.ends_on is null or h.ends_on >= (now() at time zone 'Asia/Manila')::date)) as ok`,
  );
  return found?.ok === true;
}

export async function createTender(db: Database, me: Me, input: TenderInput): Promise<{ id: number }> {
  if (!(await recordsTenders(db, me)))
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
        performance_security_form = coalesce(${input.performanceSecurityForm ?? null}, performance_security_form),
        performance_security_amount = coalesce(${input.performanceSecurityAmount ?? null}, performance_security_amount),
        performance_security_back_on = coalesce(${input.performanceSecurityBackOn ?? null}::date, performance_security_back_on),
        retention_amount = coalesce(${input.retentionAmount ?? null}, retention_amount),
        retention_back_on = coalesce(${input.retentionBackOn ?? null}::date, retention_back_on),
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
  input: { step: TenderStep; note?: string | null; on?: string | null; winningBid?: number | null; reason?: TenderReason | null },
): Promise<void> {
  const { tender } = await tenderDetail(db, me, id);
  if (!NEXT[tender.step].includes(input.step)) throw new Refusal(409, "invalid_step", `A tender ${tender.step.replace("_", " ")} cannot go to ${input.step.replace("_", " ")}.`);
  const day = input.on ?? todayManila();
  const set: SQL[] = [sql`step = ${input.step}`, sql`updated_at = now()`];
  if (input.step === "price_approved") {
    if (!(await approvesBids(db, me))) throw new Refusal(403, "not_allowed", "Government Bidding's lead approves the bid price.");
    if (!tender.ourBid) throw new Refusal(400, "invalid", "Put the bid price (the medicines and their prices) first.");
    // A line still at ₱0 has no price yet (a tender made from the finder starts with the price
    // book's Bidding price, and none where the book has none): the same rule, line by line.
    const [unpriced] = await rows<{ medicine: string }>(
      db,
      sql`select m.name || coalesce(' ' || m.strength, '') as medicine from tender_line l join medicine m on m.id = l.medicine_id
        where l.tender_id = ${id} and l.replaced_at is null and l.unit_price = 0 order by l.id limit 1`,
    );
    if (unpriced) throw new Refusal(400, "invalid", `${unpriced.medicine} has no price yet: put it before the price is approved.`);
    if (tender.abc && tender.ourBid > tender.abc) throw new Refusal(400, "invalid", "Our bid is above the ABC: it would be rejected.");
    set.push(sql`price_approved_by = ${me.id}`);
  }
  if (input.step === "submitted") {
    const missing = tender.papers.filter((p) => !p.done).map((p) => p.paper);
    if (missing.length) throw new Refusal(400, "papers", `The envelope is not complete: ${missing.join(", ")}.`);
  }
  if (input.reason && !REASONS.includes(input.reason)) throw new Refusal(400, "invalid", "Pick the reason from the list.", "reason");
  if (input.step === "lost") {
    // Why, in the report's words: picked, else read from what was written.
    const reason: TenderReason | null =
      input.reason && input.reason !== "lowest" ? input.reason : input.winningBid ? "lower_price" : input.note?.trim() ? "other" : null;
    if (!reason) throw new Refusal(400, "invalid", "Pick why we lost (and the winning bid when another was lower).", "reason");
    if (reason === "other" && !input.note?.trim()) throw new Refusal(400, "invalid", "Write why we lost.", "note");
    set.push(sql`winning_bid = ${input.winningBid ?? null}, result_note = ${input.note ?? null}, result_reason = ${reason}, result_on = ${day}::date`);
  }
  if (input.step === "won")
    set.push(sql`noa_on = ${day}::date, result_note = ${input.note ?? null}, result_reason = 'lowest', result_on = ${day}::date`);
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
  // This month's results, by the day each came (a loss counts in its own month only).
  const inMonth = (t: Tender) => (t.resultOn ?? t.noaOn ?? "").startsWith(month);
  const results = all.filter((t) => (t.step === "lost" || t.noaOn) && inMonth(t));
  const won = all.filter((t) => t.noaOn?.startsWith(month));
  const lost = all.filter((t) => t.step === "lost" && inMonth(t));
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
    canApprove: await approvesBids(db, me),
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
  // The bidding team keeps the company's papers (its lead, its people), with the CEO and the Admin.
  if (!(await approvesBids(db, me)) && me.channel?.code !== "BID" && !["ceo", "admin"].includes(me.role))
    throw new Refusal(403, "not_allowed", "The bidding team keeps the company's papers.");
  await db.execute(
    sql`insert into company_paper (name, number, expires_on, note, added_by)
      values (${input.name.trim()}, ${input.number?.trim() || null}, ${input.expiresOn || null}::date, ${input.note?.trim() || null}, ${me.id})`,
  );
}

/** The bid report (Aryan, 19 Nov: "where they went to bid, how much the others quoted, was ours
 *  approved or not, why not, how low the price went"): the tenders bid in the days asked (this
 *  year so far unless picked) with every price read and where ours stood; wins and losses by
 *  agency and by reason; the securities still out; awards late in delivery (0.1% of the late
 *  goods a day, RA 12009's IRR); the bids coming up. Each person's own tenders, a lead's team's,
 *  the bidding line's and the heads' every one (the same reach as the tender list). */
export async function bidReport(db: Database, me: Me, asked: { from?: string | null; to?: string | null }): Promise<BidReport> {
  const today = todayManila();
  const isDay = (value?: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
  const from = isDay(asked.from) ? (asked.from as string) : `${today.slice(0, 4)}-01-01`;
  const to = isDay(asked.to) ? (asked.to as string) : today;
  const all = await rows<Tender>(db, sql`${tenderSelect} where ${scope(me)} order by t.result_on desc nulls first, t.deadline_at nulls last, t.id desc`);
  const bid = all.filter(
    (t) => OPENED.includes(t.step) && (t.step === "submitted" || ((t.resultOn ?? t.noaOn ?? "") >= from && (t.resultOn ?? t.noaOn ?? "") <= to)),
  );
  const bidders = await biddersOf(db, bid.map((t) => t.id));
  const reportRows: BidReport["rows"] = bid.map((t) => {
    const standing = standingOf(t, bidders.filter((one) => one.tenderId === t.id));
    const result: BidReport["rows"][number]["result"] =
      t.step === "submitted" ? "pending" : t.step === "lost" ? (t.resultReason === "failed_bidding" ? "failed" : "lost") : "won";
    return {
      id: t.id,
      code: t.code,
      title: t.title,
      agency: t.agency,
      agencyCity: t.agencyCity,
      owner: t.owner,
      abc: t.abc,
      ourBid: t.ourBid,
      step: t.step,
      openingOn: t.openingOn,
      resultOn: t.resultOn ?? t.noaOn,
      resultReason: t.resultReason,
      resultNote: t.resultNote,
      mode: t.mode,
      ...standing,
      // A loss written with the winning bid only (before the bidders were kept): that price.
      ...(standing.lowest === null || (standing.lowest.us && t.step === "lost" && t.winningBid !== null)
        ? t.winningBid !== null && t.ourBid !== null
          ? {
              lowest: { name: "Winner", price: t.winningBid, us: false },
              gap: t.ourBid - t.winningBid,
              gapPct: t.winningBid > 0 ? Math.round(((t.ourBid - t.winningBid) / t.winningBid) * 1000) / 10 : null,
            }
          : {}
        : {}),
      result,
    };
  });
  const won = reportRows.filter((row) => row.result === "won");
  const lost = reportRows.filter((row) => row.result === "lost");
  const failed = reportRows.filter((row) => row.result === "failed");
  const gaps = lost.map((row) => row.gapPct).filter((one): one is number => one !== null && one > 0);
  const agencies = new Map<string, BidReport["byAgency"][number]>();
  for (const row of reportRows) {
    const known = agencies.get(row.agency) ?? { agency: row.agency, city: row.agencyCity, joined: 0, won: 0, lost: 0, wonValue: 0 };
    known.joined += 1;
    if (row.result === "won") {
      known.won += 1;
      known.wonValue += row.ourBid ?? 0;
    }
    if (row.result === "lost") known.lost += 1;
    agencies.set(row.agency, known);
  }
  const reasons = new Map<TenderReason, number>();
  for (const row of [...lost, ...failed]) {
    const reason = row.resultReason ?? "other";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  // Money tied up: bid securities not back (from bids still open or lost), performance securities
  // and retentions not back.
  const securities: BidReport["securities"] = [];
  for (const t of all) {
    if (t.bidSecurityAmount && !t.bidSecurityBackOn && t.step !== "dropped" && t.step !== "found" && t.step !== "preparing")
      securities.push({ id: t.id, code: t.code, agency: t.agency, kind: "bid", amount: t.bidSecurityAmount, dueBack: null });
    if (t.performanceSecurityAmount && !t.performanceSecurityBackOn)
      securities.push({ id: t.id, code: t.code, agency: t.agency, kind: "performance", amount: t.performanceSecurityAmount, dueBack: null });
    if (t.retentionAmount && !t.retentionBackOn)
      securities.push({
        id: t.id,
        code: t.code,
        agency: t.agency,
        kind: "retention",
        amount: t.retentionAmount,
        // Three months after the acceptance (the IAR), for medicines.
        dueBack: t.acceptedOn ? addMonths(t.acceptedOn, 3) : null,
      });
  }
  const late: BidReport["late"] = all
    .filter((t) => ["won", "contract"].includes(t.step) && t.deliverBy && t.deliverBy < today && !t.deliveredOn)
    .map((t) => {
      const daysLate = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${t.deliverBy}T00:00:00Z`)) / 86_400_000);
      return { id: t.id, code: t.code, agency: t.agency, deliverBy: t.deliverBy as string, daysLate, penalty: Math.round((t.ourBid ?? 0) * 0.001 * daysLate) };
    })
    .sort((a, b) => b.daysLate - a.daysLate);
  const comingUp = all
    .filter((t) => ["found", "preparing", "price_approved"].includes(t.step) && (!t.deadlineAt || t.deadlineAt.slice(0, 10) >= today))
    .sort((a, b) => (a.deadlineAt ?? "9999").localeCompare(b.deadlineAt ?? "9999"))
    .slice(0, 30)
    .map((t) => ({
      id: t.id,
      code: t.code,
      title: t.title,
      agency: t.agency,
      agencyCity: t.agencyCity,
      owner: t.owner,
      abc: t.abc,
      step: t.step,
      deadlineAt: t.deadlineAt,
      prebidOn: t.prebidOn,
      openingOn: t.openingOn,
    }));
  return {
    today,
    from,
    to,
    summary: {
      joined: reportRows.length,
      won: won.length,
      wonValue: won.reduce((sum, row) => sum + (row.ourBid ?? 0), 0),
      lost: lost.length,
      lostValue: lost.reduce((sum, row) => sum + (row.ourBid ?? 0), 0),
      pending: reportRows.filter((row) => row.result === "pending").length,
      failed: failed.length,
      winRate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
      avgGapPct: gaps.length ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10 : null,
    },
    rows: reportRows,
    byAgency: [...agencies.values()].sort((a, b) => b.joined - a.joined || b.wonValue - a.wonValue),
    byReason: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    securities,
    late,
    comingUp,
  };
}

/** A day so many months later (the 31st lands on the month's last day). */
function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
