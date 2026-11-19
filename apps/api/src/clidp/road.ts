// CLIDP's road with each distributor or pharmacy (Aryan, 19 Nov: "the CLIDP page: how many pharmacies
// we went to, did they approve us, at what rate"; docs/CHANNEL-WORK.md): approached → interested →
// agreed (the distributorship agreement, the rate per medicine) → listing filed with the FDA →
// listed (the certificate) → ordering, or declined with why. An account already buying stands at
// "ordering" from its own orders. For each: the rate agreed and the price it really paid last, its
// listings and their validity, the agreement's end, the next step, whether it is due or late to
// reorder against its own gap, and what it owes (this CRM's and Zoho's). The CLIDP Sales Coach sees
// their own; a lead, the CEO and the Admin every CLIDP coach under them (the box picked, if one).

import { type SQL, sql } from "drizzle-orm";
import { accountsOf, b2bRole } from "../b2b/service";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { inForce } from "../org/service";
import { teamSeats } from "../team/service";
import type { ClidpRoad, ClidpStage, Me } from "../types";

export const CLIDP_STAGES: ClidpStage[] = ["approached", "interested", "agreed", "filed", "listed", "ordering", "declined"];
const LEADS = ["team_lead", "manager", "ceo", "admin"];
const SOON = 60;

const ids = (list: number[]): SQL => (list.length ? sql.join(list.map((id) => sql`${id}`), sql`, `) : sql`0`);

/** The CLIDP coaches whose road this person sees, with their areas. */
async function coachesOf(db: Database, me: Me, today: string): Promise<{ personId: number; name: string; areaIds: number[] }[]> {
  if (b2bRole(me) === "clidp") {
    const areas = await rows<{ id: number }>(
      db,
      sql`select distinct s.area_id::int as id from seat s join seat_holder h on h.seat_id = s.id and ${inForce("h", today)}
        where h.person_id = ${me.id} and s.active and s.area_id is not null`,
    );
    return [{ personId: me.id, name: me.name, areaIds: areas.map((one) => one.id) }];
  }
  if (!LEADS.includes(me.role)) throw new Refusal(403, "not_allowed", "CLIDP's road is the CLIDP coaches' and their leads'.");
  const { seatIds } = await teamSeats(db, me, me.unit ?? null);
  if (!seatIds.length) return [];
  const found = await rows<{ personId: number; name: string; areaId: number | null }>(
    db,
    sql`select h.person_id::int as "personId", p.name, s.area_id::int as "areaId"
      from seat s join seat_holder h on h.seat_id = s.id and ${inForce("h", today)} join person p on p.id = h.person_id
      where s.id in (${ids(seatIds)}) and s.active and s.module = 'medrep' and s.title ilike '%clidp%'`,
  );
  const byPerson = new Map<number, { personId: number; name: string; areaIds: number[] }>();
  for (const one of found) {
    const known = byPerson.get(one.personId) ?? { personId: one.personId, name: one.name, areaIds: [] };
    if (one.areaId) known.areaIds.push(one.areaId);
    byPerson.set(one.personId, known);
  }
  return [...byPerson.values()];
}

export async function clidpRoad(db: Database, me: Me): Promise<ClidpRoad> {
  const today = todayManila();
  const first = `${today.slice(0, 7)}-01`;
  const coaches = await coachesOf(db, me, today);
  const empty: ClidpRoad = {
    today,
    canEdit: b2bRole(me) === "clidp" || LEADS.includes(me.role),
    coaches: [],
    counts: { approached: 0, interested: 0, agreed: 0, filed: 0, listed: 0, ordering: 0, declined: 0 },
    month: { approached: 0, agreed: 0, listed: 0, declined: 0, firstOrders: 0 },
    rows: [],
  };
  if (!coaches.length) return empty;
  const coachIds = coaches.map((one) => one.personId);
  const areaIds = coaches.flatMap((one) => one.areaIds);
  // Who works which area (an account already buying is its area's coach's).
  const coachOfArea = new Map<number, string>();
  for (const one of coaches) for (const area of one.areaIds) coachOfArea.set(area, one.name);
  const [road, buying] = await Promise.all([
    rows<{
      customerId: number;
      name: string;
      kind: string;
      city: string | null;
      coach: string;
      stage: ClidpStage;
      approachedOn: string;
      interestedOn: string | null;
      agreedOn: string | null;
      filedOn: string | null;
      listedOn: string | null;
      declinedOn: string | null;
      declinedReason: string | null;
      agreementUntil: string | null;
      nextStep: string | null;
      nextOn: string | null;
      note: string | null;
    }>(
      db,
      sql`select a.customer_id::int as "customerId", c.name, c.kind, c.city, p.name as coach, a.stage,
          to_char(a.approached_on, 'YYYY-MM-DD') as "approachedOn", to_char(a.interested_on, 'YYYY-MM-DD') as "interestedOn",
          to_char(a.agreed_on, 'YYYY-MM-DD') as "agreedOn", to_char(a.filed_on, 'YYYY-MM-DD') as "filedOn",
          to_char(a.listed_on, 'YYYY-MM-DD') as "listedOn", to_char(a.declined_on, 'YYYY-MM-DD') as "declinedOn",
          a.declined_reason as "declinedReason", to_char(a.agreement_until, 'YYYY-MM-DD') as "agreementUntil",
          a.next_step as "nextStep", to_char(a.next_on, 'YYYY-MM-DD') as "nextOn", a.note
        from clidp_account a join customer c on c.id = a.customer_id join person p on p.id = a.coach_id
        where a.coach_id in (${ids(coachIds)})`,
    ),
    accountsOf(db, coachIds, areaIds, today),
  ]);
  const customerIds = [...new Set([...road.map((one) => one.customerId), ...buying.map((one) => one.customerId)])];
  const [rates, prices, listings, owed, firsts, areaOf] = await Promise.all([
    rows<{ customerId: number; medicine: string; unitPrice: number; moq: number | null; agreedOn: string }>(
      db,
      sql`select r.customer_id::int as "customerId", m.name || coalesce(' ' || m.strength, '') as medicine,
          r.unit_price::float8 as "unitPrice", r.moq, to_char(r.agreed_on, 'YYYY-MM-DD') as "agreedOn"
        from clidp_rate r join medicine m on m.id = r.medicine_id
        where r.customer_id in (${ids(customerIds)}) and r.replaced_at is null order by r.agreed_on desc`,
    ),
    // The price each really paid last, medicine by medicine (the three latest medicines).
    rows<{ customerId: number; medicine: string; unitPrice: number; qty: number; on: string }>(
      db,
      sql`with lines as (
          select o.customer_id as cid, (coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Manila')::date as at,
            m.name || coalesce(' ' || m.strength, '') as medicine, i.unit_price as price, i.qty
          from order_item i join sales_order o on o.id = i.order_id join medicine m on m.id = i.medicine_id
          where o.customer_id in (${ids(customerIds)}) and o.status not in ('draft', 'cancelled') and not i.free
          union all
          select p.customer_id, p.ordered_on, coalesce(m.name || coalesce(' ' || m.strength, ''), i.name), i.unit_price, i.qty
          from past_order_item i join past_order p on p.id = i.past_order_id
            left join medicine m on i.sku is not null and lower(m.sku) = lower(i.sku)
          where p.customer_id in (${ids(customerIds)}) and p.status <> 'void' and not i.free
        ),
        latest as (select *, row_number() over (partition by cid, medicine order by at desc) as rn from lines),
        top as (select *, row_number() over (partition by cid order by at desc, medicine) as k from latest where rn = 1)
        select cid::int as "customerId", medicine, price::float8 as "unitPrice", qty::int as qty, to_char(at, 'YYYY-MM-DD') as on
        from top where k <= 3 order by cid, at desc`,
    ),
    rows<{ customerId: number; brand: string; medicine: string; certificateNo: string | null; validUntil: string | null; daysLeft: number | null }>(
      db,
      sql`select l.customer_id::int as "customerId", l.brand, m.name || coalesce(' ' || m.strength, '') as medicine,
          l.certificate_no as "certificateNo", to_char(l.valid_until, 'YYYY-MM-DD') as "validUntil", (l.valid_until - ${today}::date)::int as "daysLeft"
        from clidp_listing l join medicine m on m.id = l.medicine_id
        where l.customer_id in (${ids(customerIds)})
          and not exists (select 1 from clidp_listing n where n.customer_id = l.customer_id and n.medicine_id = l.medicine_id and n.id > l.id)
        order by l.valid_until nulls last`,
    ),
    // What each owes: this CRM's open invoices and Zoho's still open.
    rows<{ customerId: number; owed: number; overdue: number }>(
      db,
      sql`select customer_id::int as "customerId", sum(amount)::float8 as owed, coalesce(sum(amount) filter (where late), 0)::float8 as overdue from (
          select i.customer_id, (i.total - i.paid) as amount, i.due_on < ${today}::date as late from invoice i
            where i.customer_id in (${ids(customerIds)}) and i.status = 'open' and i.total > i.paid
          union all
          select d.customer_id, round(d.balance * d.fx_rate), d.due_date < ${today}::date from book_doc d
            where d.customer_id in (${ids(customerIds)}) and d.kind = 'invoice' and d.zoho_id is not null and d.balance > 0
              and d.status not in ('void', 'draft')) x group by customer_id`,
    ),
    // Each account's first order ever (a first order this month is a new account).
    rows<{ customerId: number; first: string; year: number }>(
      db,
      sql`select cid::int as "customerId", to_char(min(d), 'YYYY-MM-DD') as first,
          coalesce(sum(total) filter (where d > ${addDays(today, -365)}::date), 0)::float8 as year from (
          select customer_id as cid, issued_on as d, total from invoice where customer_id in (${ids(customerIds)}) and status <> 'cancelled'
          union all select customer_id, ordered_on, total from past_order where customer_id in (${ids(customerIds)}) and status <> 'void') x group by cid`,
    ),
    rows<{ customerId: number; areaId: number | null }>(
      db,
      sql`select id::int as "customerId", area_id::int as "areaId" from customer where id in (${ids(customerIds)})`,
    ),
  ]);
  const area = new Map(areaOf.map((one) => [one.customerId, one.areaId]));
  const firstOf = new Map(firsts.map((one) => [one.customerId, one]));
  const owedOf = new Map(owed.map((one) => [one.customerId, one]));
  const byRoad = new Map(road.map((one) => [one.customerId, one]));
  const byBuying = new Map(buying.map((one) => [one.customerId, one]));
  const rowsOut: ClidpRoad["rows"] = customerIds.map((customerId) => {
    const onRoad = byRoad.get(customerId);
    const bought = byBuying.get(customerId);
    // On the road as written; an account buying and not written is "ordering"; one written but
    // buying since moves to "ordering" too (its orders say so), unless declined.
    const stage: ClidpStage = onRoad
      ? onRoad.stage !== "declined" && bought && onRoad.stage !== "ordering"
        ? "ordering"
        : onRoad.stage
      : "ordering";
    const stageOn =
      stage === "ordering"
        ? (firstOf.get(customerId)?.first ?? bought?.lastOrderOn ?? null)
        : (onRoad?.[`${stage}On` as "approachedOn"] ?? onRoad?.approachedOn ?? null);
    const money = owedOf.get(customerId);
    return {
      customerId,
      name: onRoad?.name ?? bought?.name ?? "",
      kind: onRoad?.kind ?? bought?.kind ?? "distributor",
      city: onRoad?.city ?? bought?.city ?? null,
      coach: onRoad?.coach ?? coachOfArea.get(area.get(customerId) ?? 0) ?? null,
      stage,
      stageOn,
      approachedOn: onRoad?.approachedOn ?? null,
      agreedOn: onRoad?.agreedOn ?? null,
      listedOn: onRoad?.listedOn ?? null,
      declinedReason: onRoad?.declinedReason ?? null,
      agreementUntil: onRoad?.agreementUntil ?? null,
      nextStep: onRoad?.nextStep ?? null,
      nextOn: onRoad?.nextOn ?? null,
      note: onRoad?.note ?? null,
      rates: rates.filter((one) => one.customerId === customerId).map(({ customerId: _c, ...one }) => one),
      lastPrices: prices.filter((one) => one.customerId === customerId).map(({ customerId: _c, ...one }) => one),
      listings: listings
        .filter((one) => one.customerId === customerId)
        .map(({ customerId: _c, ...one }) => ({
          ...one,
          state: one.daysLeft === null ? "no date" : one.daysLeft < 0 ? "expired" : one.daysLeft <= SOON ? "expiring" : "valid",
        })),
      lastOrderOn: bought?.lastOrderOn ?? null,
      reorder: bought ? bought.state : null,
      usual: bought?.usual ?? null,
      soldYear: firstOf.get(customerId)?.year ?? 0,
      firstOrderOn: firstOf.get(customerId)?.first ?? null,
      owed: money?.owed ?? 0,
      overdue: money?.overdue ?? 0,
    };
  });
  const order: ClidpStage[] = ["agreed", "filed", "interested", "approached", "listed", "ordering", "declined"];
  rowsOut.sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage) || b.soldYear - a.soldYear || a.name.localeCompare(b.name));
  const count = (stage: ClidpStage) => rowsOut.filter((one) => one.stage === stage).length;
  const inMonth = (day: string | null) => Boolean(day && day >= first);
  // The coaches side by side: their road and their money.
  const coachRows: ClidpRoad["coaches"] = coaches.map((one) => {
    const theirs = rowsOut.filter((row) => row.coach === one.name);
    return {
      personId: one.personId,
      name: one.name,
      approached: theirs.filter((row) => row.stage !== "ordering" || row.approachedOn).length,
      agreed: theirs.filter((row) => ["agreed", "filed", "listed", "ordering"].includes(row.stage) && (row.agreedOn || row.stage === "ordering")).length,
      listed: theirs.filter((row) => row.listings.some((l) => l.state !== "expired")).length,
      ordering: theirs.filter((row) => row.stage === "ordering").length,
      late: theirs.filter((row) => row.reorder === "late" || row.reorder === "stopped").length,
      listingsEnding: theirs.flatMap((row) => row.listings).filter((l) => l.state === "expiring" || l.state === "expired").length,
      owed: theirs.reduce((sum, row) => sum + row.owed, 0),
      overdue: theirs.reduce((sum, row) => sum + row.overdue, 0),
    };
  });
  return {
    today,
    canEdit: empty.canEdit,
    coaches: coachRows,
    counts: {
      approached: count("approached"),
      interested: count("interested"),
      agreed: count("agreed"),
      filed: count("filed"),
      listed: count("listed"),
      ordering: count("ordering"),
      declined: count("declined"),
    },
    month: {
      approached: road.filter((one) => inMonth(one.approachedOn)).length,
      agreed: road.filter((one) => inMonth(one.agreedOn)).length,
      listed: road.filter((one) => inMonth(one.listedOn)).length,
      declined: road.filter((one) => inMonth(one.declinedOn)).length,
      firstOrders: rowsOut.filter((one) => inMonth(one.firstOrderOn)).length,
    },
    rows: rowsOut,
  };
}

/** Who may work this account's road: its coach, a CLIDP coach taking it, or a lead over them. */
async function mayWork(db: Database, me: Me): Promise<void> {
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Nothing can be changed while looking as someone.");
  if (b2bRole(me) !== "clidp" && !LEADS.includes(me.role))
    throw new Refusal(403, "not_allowed", "The CLIDP Sales Coach (or their lead) works CLIDP's road.");
}

/** A pharmacy or distributor approached (Aryan: "how many pharmacies we went to"). */
export async function addProspect(
  db: Database,
  me: Me,
  input: { customerId: number; on?: string | null; note?: string | null; nextStep?: string | null; nextOn?: string | null; coachId?: number | null },
): Promise<void> {
  await mayWork(db, me);
  const [customer] = await rows<{ kind: string }>(db, sql`select kind from customer where id = ${input.customerId} and active`);
  if (!customer || !["distributor", "drugstore", "hospital"].includes(customer.kind))
    throw new Refusal(400, "invalid", "CLIDP's road is with a distributor or a pharmacy.", "customerId");
  const coach = b2bRole(me) === "clidp" ? me.id : input.coachId;
  if (!coach) throw new Refusal(400, "invalid", "Pick the CLIDP Sales Coach who works it.", "coachId");
  const day = input.on ?? todayManila();
  await db.transaction(async (tx) => {
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into clidp_account (customer_id, coach_id, stage, approached_on, next_step, next_on, note)
        values (${input.customerId}, ${coach}, 'approached', ${day}::date, ${input.nextStep?.trim() || null},
          ${input.nextOn ?? null}::date, ${input.note?.trim() || null})
        on conflict (customer_id) do nothing returning id::int as id`,
    );
    if (!made) throw new Refusal(409, "taken", "This one is already on CLIDP's road.", "customerId");
    await tx.execute(sql`insert into clidp_account_event (account_id, stage, note, by_person) values (${made.id}, 'approached', ${input.note?.trim() || null}, ${me.id})`);
  });
}

/** The next stage on the road (or declined), with its day and what goes with it. */
export async function moveClidp(
  db: Database,
  me: Me,
  customerId: number,
  input: {
    stage: ClidpStage;
    on?: string | null;
    note?: string | null;
    declinedReason?: string | null;
    agreementUntil?: string | null;
    nextStep?: string | null;
    nextOn?: string | null;
  },
): Promise<void> {
  await mayWork(db, me);
  if (!CLIDP_STAGES.includes(input.stage)) throw new Refusal(400, "invalid", "Pick the stage.", "stage");
  const day = input.on ?? todayManila();
  let [account] = await rows<{ id: number; stage: ClidpStage }>(db, sql`select id::int as id, stage from clidp_account where customer_id = ${customerId}`);
  if (!account) {
    // An account buying before it was written on the road: written now, for the coach of its area.
    const [coach] = await rows<{ id: number }>(
      db,
      sql`select h.person_id::int as id from customer c join seat s on s.area_id = c.area_id and s.active and s.title ilike '%clidp%'
        join seat_holder h on h.seat_id = s.id and ${inForce("h", todayManila())} where c.id = ${customerId} limit 1`,
    );
    await addProspect(db, me, { customerId, on: day, coachId: coach?.id ?? null });
    [account] = await rows<{ id: number; stage: ClidpStage }>(db, sql`select id::int as id, stage from clidp_account where customer_id = ${customerId}`);
  }
  if (!account) throw new Refusal(404, "not_found", "Not on CLIDP's road.");
  if (input.stage === "declined" && !input.declinedReason?.trim())
    throw new Refusal(400, "invalid", "Say why they declined.", "declinedReason");
  const set: SQL[] = [sql`stage = ${input.stage}`, sql`updated_at = now()`];
  const dayColumn: Partial<Record<ClidpStage, string>> = {
    interested: "interested_on",
    agreed: "agreed_on",
    filed: "filed_on",
    listed: "listed_on",
    declined: "declined_on",
  };
  const column = dayColumn[input.stage];
  if (column) set.push(sql`${sql.raw(column)} = ${day}::date`);
  if (input.stage === "declined") set.push(sql`declined_reason = ${input.declinedReason?.trim() ?? null}`);
  if (input.agreementUntil !== undefined) set.push(sql`agreement_until = ${input.agreementUntil ?? null}::date`);
  if (input.nextStep !== undefined) set.push(sql`next_step = ${input.nextStep?.trim() || null}`);
  if (input.nextOn !== undefined) set.push(sql`next_on = ${input.nextOn ?? null}::date`);
  if (input.note !== undefined && input.note !== null) set.push(sql`note = ${input.note.trim() || null}`);
  await db.transaction(async (tx) => {
    await tx.execute(sql`update clidp_account set ${sql.join(set, sql`, `)} where id = ${account?.id}`);
    await tx.execute(
      sql`insert into clidp_account_event (account_id, stage, note, by_person)
        values (${account?.id}, ${input.stage}, ${input.declinedReason?.trim() || input.note?.trim() || null}, ${me.id})`,
    );
  });
}

/** The rate agreed for one medicine (one piece, VAT in) and its minimum order; replaces the last. */
export async function setClidpRate(
  db: Database,
  me: Me,
  input: { customerId: number; medicineId: number; unitPrice: number; moq?: number | null; on?: string | null },
): Promise<void> {
  await mayWork(db, me);
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`update clidp_rate set replaced_at = now() where customer_id = ${input.customerId} and medicine_id = ${input.medicineId} and replaced_at is null`,
    );
    await tx.execute(
      sql`insert into clidp_rate (customer_id, medicine_id, unit_price, moq, agreed_on, by_person)
        values (${input.customerId}, ${input.medicineId}, ${input.unitPrice}, ${input.moq ?? null}, ${input.on ?? todayManila()}::date, ${me.id})`,
    );
  });
}
