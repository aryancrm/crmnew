// The hospitals board (Aryan, 19 Nov: "press Julius and his whole team shows: who is where, what
// each is doing, which hospitals each has, whom to call, every relevant thing"; docs/CHANNEL-WORK.md
// HOSP): each hospital a seller has (their areas' hospitals and government hospitals, and the ones
// their orders went to), with 2MG's accreditation there and its validity, our medicines on its
// formulary, its buying against its own reorder gap, the orders open with it (POs waiting to be
// delivered), what it owes, the last visit and the next one planned, the last call. A Hospital CHC
// sees their own; a team lead their team's (or one box of it); a head the division's.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { inForce } from "../org/service";
import { teamSeats } from "../team/service";
import type { HospitalBoard, Me } from "../types";

const LEADS = ["team_lead", "manager", "ceo", "admin"];
const SOON = 60;
const ids = (list: number[]): SQL => (list.length ? sql.join(list.map((id) => sql`${id}`), sql`, `) : sql`0`);

/** The seats whose hospitals these are: the person's own, or a lead's team's (the box picked). */
async function seatsOf(db: Database, me: Me, today: string): Promise<number[]> {
  if (me.role === "medrep") {
    const mine = await rows<{ id: number }>(
      db,
      sql`select h.seat_id::int as id from seat_holder h join seat s on s.id = h.seat_id and s.active
        where h.person_id = ${me.id} and ${inForce("h", today)}`,
    );
    return mine.map((one) => one.id);
  }
  if (!LEADS.includes(me.role)) throw new Refusal(403, "not_allowed", "The hospitals board is the sellers' and their leads'.");
  return (await teamSeats(db, me, me.unit ?? null)).seatIds;
}

export async function hospitalBoard(db: Database, me: Me): Promise<HospitalBoard> {
  const today = todayManila();
  const first = `${today.slice(0, 7)}-01`;
  const [year, month] = today.split("-").map(Number) as [number, number];
  const lastDay = `${today.slice(0, 7)}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
  const seatIds = await seatsOf(db, me, today);
  const empty: HospitalBoard = {
    today,
    canEdit: !me.viewedBy,
    summary: {
      hospitals: 0,
      accredited: 0,
      expiring: 0,
      notAccredited: 0,
      formularyApproved: 0,
      formularyPending: 0,
      due: 0,
      late: 0,
      stopped: 0,
      owed: 0,
      overdue: 0,
      openOrders: 0,
      openValue: 0,
      visitsDone: 0,
      visitsPlanned: 0,
    },
    rows: [],
  };
  if (!seatIds.length) return empty;
  const seats = ids(seatIds);
  const found = await rows<Omit<HospitalBoard["rows"][number], "accreditation" | "formulary" | "reorder">>(
    db,
    sql`with mine as (
        select c.id from customer c where c.active and c.kind in ('hospital', 'government') and (
          c.area_id in (select s.area_id from seat s where s.id in (${seats}) and s.area_id is not null)
          or c.id in (select o.customer_id from sales_order o where o.seat_id in (${seats}) and o.status not in ('draft', 'cancelled')))
      ),
      days as (
        select i.customer_id as cid, i.issued_on as d, i.total::float8 as total from invoice i
          where i.customer_id in (select id from mine) and i.status <> 'cancelled'
        union all
        select p.customer_id, p.ordered_on, p.total::float8 from past_order p
          where p.customer_id in (select id from mine) and p.status <> 'void'
      ),
      g as (select cid, d, total, d - lag(d) over (partition by cid order by d) as gap, row_number() over (partition by cid order by d desc) as rn
        from (select cid, d, sum(total) as total from days group by cid, d) x),
      s as (select cid, max(d) as last,
          greatest(7, coalesce(percentile_cont(0.5) within group (order by gap) filter (where gap is not null and rn <= 7), 28))::float8 as usual,
          coalesce(sum(total) filter (where d >= ${first}::date), 0) as month,
          coalesce(sum(total) filter (where d > ${addDays(today, -365)}::date), 0) as year
        from g group by cid),
      owed as (
        select customer_id as cid, sum(amount)::float8 as owed, coalesce(sum(amount) filter (where late), 0)::float8 as overdue from (
          select i.customer_id, (i.total - i.paid) as amount, i.due_on < ${today}::date as late from invoice i
            where i.customer_id in (select id from mine) and i.status = 'open' and i.total > i.paid
          union all
          select d.customer_id, round(d.balance * d.fx_rate), d.due_date < ${today}::date from book_doc d
            where d.customer_id in (select id from mine) and d.kind = 'invoice' and d.zoho_id is not null and d.balance > 0
              and d.status not in ('void', 'draft')) x group by customer_id
      )
      select c.id::int as "customerId", c.name, c.kind, c.city,
        (select p.name from seat st join seat_holder h on h.seat_id = st.id and h.kind = 'holder' and h.ends_on is null
           join person p on p.id = h.person_id where st.area_id = c.area_id order by h.starts_on desc limit 1) as seller,
        to_char(s.last, 'YYYY-MM-DD') as "lastOrderOn", (${today}::date - s.last)::int as since, round(s.usual)::int as usual,
        coalesce(s.month, 0)::float8 as "soldMonth", coalesce(s.year, 0)::float8 as "soldYear",
        coalesce(owed.owed, 0)::float8 as owed, coalesce(owed.overdue, 0)::float8 as overdue,
        (select count(*) from sales_order o where o.customer_id = c.id and o.status not in ('draft', 'cancelled', 'completed'))::int as "openOrders",
        coalesce((select sum(o.total) from sales_order o where o.customer_id = c.id
          and o.status not in ('draft', 'cancelled', 'completed')), 0)::float8 as "openValue",
        (select to_char(max(v.day), 'YYYY-MM-DD') from visit v where v.customer_id = c.id and v.status = 'done') as "lastVisitOn",
        (select to_char(min(v.day), 'YYYY-MM-DD') from visit v where v.customer_id = c.id and v.status = 'planned' and v.day >= ${today}::date) as "nextVisitOn",
        (select to_char(max(k.at) at time zone 'Asia/Manila', 'YYYY-MM-DD') from account_call k where k.customer_id = c.id) as "lastCallOn"
      from mine join customer c on c.id = mine.id left join s on s.cid = c.id left join owed on owed.cid = c.id
      order by coalesce(s.year, 0) desc, c.name
      limit 500`,
  );
  const customerIds = found.map((one) => one.customerId);
  const [accreditations, formulary, visits] = await Promise.all([
    rows<{ customerId: number; status: "applied" | "accredited" | "refused"; onDay: string; validUntil: string | null }>(
      db,
      sql`select distinct on (a.customer_id) a.customer_id::int as "customerId", a.status, to_char(a.on_day, 'YYYY-MM-DD') as "onDay",
          to_char(a.valid_until, 'YYYY-MM-DD') as "validUntil"
        from hospital_accreditation a where a.customer_id in (${ids(customerIds)}) order by a.customer_id, a.id desc`,
    ),
    rows<{ customerId: number; medicine: string; status: "requested" | "approved" | "not_approved" | "removed"; onDay: string; doctor: string | null }>(
      db,
      sql`select distinct on (f.customer_id, f.medicine_id) f.customer_id::int as "customerId",
          m.name || coalesce(' ' || m.strength, '') as medicine, f.status, to_char(f.on_day, 'YYYY-MM-DD') as "onDay", f.doctor
        from hospital_formulary f join medicine m on m.id = f.medicine_id
        where f.customer_id in (${ids(customerIds)}) order by f.customer_id, f.medicine_id, f.id desc`,
    ),
    rows<{ done: number; planned: number }>(
      db,
      sql`select count(*) filter (where v.status = 'done')::int as done, count(*)::int as planned from visit v
        where v.seat_id in (${seats}) and v.day between ${first}::date and ${lastDay}::date`,
    ),
  ]);
  const weekAhead = addDays(today, 7);
  const rowsOut: HospitalBoard["rows"] = found.map((one) => {
    const accreditation = accreditations.find((a) => a.customerId === one.customerId);
    const daysLeft = accreditation?.validUntil
      ? Math.round((Date.parse(`${accreditation.validUntil}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
      : null;
    const items = formulary.filter((f) => f.customerId === one.customerId).map(({ customerId: _c, ...f }) => f);
    const reorder: HospitalBoard["rows"][number]["reorder"] =
      one.lastOrderOn === null || one.since === null
        ? "never"
        : one.since > 180
          ? "lost"
          : one.since > 90
            ? "stopped"
            : one.since > 1.5 * (one.usual ?? 28)
              ? "late"
              : addDays(one.lastOrderOn, one.usual ?? 28) <= weekAhead
                ? "due"
                : "ok";
    return {
      ...one,
      reorder,
      accreditation: accreditation
        ? {
            status: accreditation.status,
            onDay: accreditation.onDay,
            validUntil: accreditation.validUntil,
            daysLeft,
            state:
              accreditation.status === "accredited"
                ? daysLeft === null
                  ? "accredited"
                  : daysLeft < 0
                    ? "expired"
                    : daysLeft <= SOON
                      ? "expiring"
                      : "accredited"
                : accreditation.status,
          }
        : { status: null, onDay: null, validUntil: null, daysLeft: null, state: "none" },
      formulary: {
        approved: items.filter((f) => f.status === "approved").length,
        requested: items.filter((f) => f.status === "requested").length,
        items,
      },
    };
  });
  const state = (key: HospitalBoard["rows"][number]["accreditation"]["state"]) =>
    rowsOut.filter((one) => one.accreditation.state === key).length;
  return {
    today,
    canEdit: !me.viewedBy,
    summary: {
      hospitals: rowsOut.length,
      accredited: state("accredited") + state("expiring"),
      expiring: state("expiring"),
      notAccredited: state("none") + state("expired") + state("refused") + state("applied"),
      formularyApproved: rowsOut.reduce((sum, one) => sum + one.formulary.approved, 0),
      formularyPending: rowsOut.reduce((sum, one) => sum + one.formulary.requested, 0),
      due: rowsOut.filter((one) => one.reorder === "due").length,
      late: rowsOut.filter((one) => one.reorder === "late").length,
      stopped: rowsOut.filter((one) => one.reorder === "stopped").length,
      owed: rowsOut.reduce((sum, one) => sum + one.owed, 0),
      overdue: rowsOut.reduce((sum, one) => sum + one.overdue, 0),
      openOrders: rowsOut.reduce((sum, one) => sum + one.openOrders, 0),
      openValue: rowsOut.reduce((sum, one) => sum + one.openValue, 0),
      visitsDone: visits[0]?.done ?? 0,
      visitsPlanned: visits[0]?.planned ?? 0,
    },
    rows: rowsOut,
  };
}

/** Who may write a hospital's standing: a seller or a lead, never someone looking as another. */
function mayWrite(me: Me): void {
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Nothing can be changed while looking as someone.");
  if (me.role !== "medrep" && !LEADS.includes(me.role)) throw new Refusal(403, "not_allowed", "The sellers and their leads keep this.");
}

async function hospitalOf(db: Database, customerId: number): Promise<void> {
  const [found] = await rows<{ kind: string }>(db, sql`select kind from customer where id = ${customerId} and active`);
  if (!found || !["hospital", "government"].includes(found.kind)) throw new Refusal(400, "invalid", "Pick a hospital.", "customerId");
}

/** 2MG's accreditation at a hospital: applied, accredited (until when), or refused. */
export async function setAccreditation(
  db: Database,
  me: Me,
  input: { customerId: number; status: "applied" | "accredited" | "refused"; on?: string | null; validUntil?: string | null; note?: string | null },
): Promise<void> {
  mayWrite(me);
  await hospitalOf(db, input.customerId);
  if (input.status === "refused" && !input.note?.trim()) throw new Refusal(400, "invalid", "Say why it was refused.", "note");
  await db.execute(
    sql`insert into hospital_accreditation (customer_id, status, on_day, valid_until, note, by_person)
      values (${input.customerId}, ${input.status}, ${input.on ?? todayManila()}::date, ${input.validUntil ?? null}::date,
        ${input.note?.trim() || null}, ${me.id})`,
  );
}

/** One of our medicines on a hospital's formulary: requested, approved, not approved, removed. */
export async function setFormulary(
  db: Database,
  me: Me,
  input: {
    customerId: number;
    medicineId: number;
    status: "requested" | "approved" | "not_approved" | "removed";
    on?: string | null;
    doctor?: string | null;
    note?: string | null;
  },
): Promise<void> {
  mayWrite(me);
  await hospitalOf(db, input.customerId);
  await db.execute(
    sql`insert into hospital_formulary (customer_id, medicine_id, status, on_day, doctor, note, by_person)
      values (${input.customerId}, ${input.medicineId}, ${input.status}, ${input.on ?? todayManila()}::date,
        ${input.doctor?.trim() || null}, ${input.note?.trim() || null}, ${me.id})`,
  );
}
