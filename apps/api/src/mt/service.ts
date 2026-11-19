// Modern Trade (docs/PLAN.md 16.7; docs/CHANNEL-WORK.md MT): the Chief Operating Officer and her two
// sellers' seats (Arlene's, Jasper's; vacant until they are in the ERP). Her day: each chain's last
// order and whether it is due or late against its own gap; what each chain bought from Modern Trade
// this month and in 12 months, owes and how old; what it deducted from its payments (near-expiry
// goods kept, listing fees, promos, penalties: Finance records each with the payment) and sent back;
// which of our medicines each chain lists and in how many branches.

import { sql } from "drizzle-orm";
import { accountsOf } from "../b2b/service";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { inForce } from "../org/service";
import type { DeductionKind, Me, MtDay } from "../types";

const mtPerson = (me: Me) => me.channel?.code === "MT" || me.business === "MT";
const mayLook = (me: Me) => mtPerson(me) || ["ceo", "admin"].includes(me.role);

export async function mtDay(db: Database, me: Me): Promise<MtDay> {
  if (!mayLook(me)) throw new Refusal(403, "not_allowed", "This is Modern Trade's desk.");
  const today = todayManila();
  const first = `${today.slice(0, 7)}-01`;
  const yearAgo = addDays(today, -365);
  // Modern Trade's seats (the box the tracker calls MT): a seller sees their own; the COO, the CEO
  // and the Admin every one, vacant ones too.
  const seats = await rows<{ seatId: number; title: string; lead: boolean; areaId: number | null; name: string | null; zoho: string | null }>(
    db,
    sql`select s.id::int as "seatId", s.title, s.lead, s.area_id::int as "areaId",
        (select p.name from seat_holder h join person p on p.id = h.person_id where h.seat_id = s.id and h.kind = 'holder'
          and ${inForce("h", today)} order by h.starts_on desc limit 1) as name,
        (select string_agg(zs.name, ', ' order by zs.name) from zoho_seller zs where zs.seat_id = s.id) as zoho
      from seat s where s.active and unit_division(s.unit_id) = 'MT'
        ${me.role === "medrep" ? sql`and s.id in (select h.seat_id from seat_holder h where h.person_id = ${me.id} and ${inForce("h", today)})` : sql``}
      order by s.lead desc, s.title, s.id`,
  );
  const seatList = seats.length ? sql.join(seats.map((one) => sql`${one.seatId}`), sql`, `) : sql`0`;
  const areaIds = seats.map((one) => one.areaId).filter((id): id is number => id !== null);
  // The chains: the customers of Modern Trade's areas and every customer its seats invoiced in two years.
  const invoiced = await rows<{ id: number }>(
    db,
    sql`select distinct customer_id::int as id from sale_invoice
      where seat_id in (${seatList}) and status <> 'cancelled' and customer_id is not null and issued_on > ${addDays(today, -730)}::date`,
  );
  const accounts = await accountsOf(db, [me.id], areaIds, today, invoiced.map((one) => one.id));
  // Every customer Modern Trade's seats invoiced counts in its money, also one with no order on
  // record to measure its gap by (a Zoho invoice made without a Zoho order).
  const ids = [...new Set([...accounts.map((a) => a.customerId), ...invoiced.map((one) => one.id)])];
  const chainList = ids.length ? sql.join(ids.map((id) => sql`${id}`), sql`, `) : sql`0`;
  const [money, deductions, returns, seatFigures, listings] = await Promise.all([
    rows<Omit<MtDay["money"][number], "seller" | "zoho" | "deducted" | "returns" | "returnsCredit"> & { lastSeat: number | null }>(
      db,
      sql`select si.customer_id::int as "customerId", (select c.name from customer c where c.id = si.customer_id) as name,
          coalesce(sum(si.total) filter (where si.issued_on between ${first}::date and ${today}::date), 0)::float8 as "soldMonth",
          coalesce(sum(si.total) filter (where si.issued_on > ${yearAgo}::date), 0)::float8 as "sold12",
          coalesce(sum(si.total - si.paid) filter (where si.status = 'open' and si.total > si.paid), 0)::float8 as owed,
          coalesce(sum(si.total - si.paid) filter (where si.status = 'open' and si.total > si.paid and si.due_on < ${today}::date), 0)::float8 as overdue,
          max(${today}::date - si.issued_on) filter (where si.status = 'open' and si.total > si.paid)::int as "oldestDays",
          (array_agg(si.seat_id order by si.issued_on desc))[1]::int as "lastSeat"
        from sale_invoice si where si.seat_id in (${seatList}) and si.status <> 'cancelled' and si.customer_id is not null
        group by si.customer_id`,
    ),
    // What the chains kept back from their payments (this CRM's payments; Finance records each with
    // its why), the last 12 months.
    rows<{ customerId: number; kind: DeductionKind; count: number; amount: number }>(
      db,
      sql`select i.customer_id::int as "customerId", coalesce(p.deduction_kind, 'other') as kind, count(*)::int as count, sum(p.amount)::float8 as amount
        from payment p join invoice i on i.id = p.invoice_id
        where p.active and p.method = 'deduction' and p.paid_on > ${yearAgo}::date and i.customer_id in (${chainList})
        group by 1, 2`,
    ),
    rows<{ customerId: number; reason: string; count: number; credit: number }>(
      db,
      sql`select o.customer_id::int as "customerId", r.reason, count(*)::int as count,
          coalesce(sum(r.credit) filter (where r.credited_at is not null), 0)::float8 as credit
        from sales_return r join sales_order o on o.id = r.order_id
        where r.status not in ('rejected', 'cancelled') and r.requested_at > ${yearAgo}::date and o.customer_id in (${chainList})
        group by 1, 2`,
    ),
    rows<{ seatId: number; chains: number; soldMonth: number; owed: number }>(
      db,
      sql`select si.seat_id::int as "seatId",
          count(distinct si.customer_id) filter (where si.issued_on > ${today}::date - 90)::int as chains,
          coalesce(sum(si.total) filter (where si.issued_on between ${first}::date and ${today}::date), 0)::float8 as "soldMonth",
          coalesce(sum(si.total - si.paid) filter (where si.status = 'open' and si.total > si.paid), 0)::float8 as owed
        from sale_invoice si where si.seat_id in (${seatList}) and si.status <> 'cancelled' group by 1`,
    ),
    ids.length
      ? rows<MtDay["listings"][number]>(
          db,
          sql`select l.id::int as id, l.customer_id::int as "customerId", c.name as chain, m.name || coalesce(' ' || m.strength, '') as medicine,
              l.branches, l.listed, to_char(l.added_at at time zone 'Asia/Manila', 'YYYY-MM-DD') as since
            from mt_listing l join customer c on c.id = l.customer_id join medicine m on m.id = l.medicine_id
            where l.customer_id in (${chainList})
              and not exists (select 1 from mt_listing n where n.customer_id = l.customer_id and n.medicine_id = l.medicine_id and n.id > l.id)
            order by c.name, m.name`,
        )
      : Promise.resolve([] as MtDay["listings"]),
  ]);
  const seatOf = (id: number | null) => seats.find((one) => one.seatId === id);
  const KINDS: DeductionKind[] = ["near_expiry", "listing_fee", "promo", "penalty", "other"];
  const reasons = [...new Set(returns.map((one) => one.reason))];
  return {
    today,
    chains: accounts,
    money: money.map(({ lastSeat, ...one }) => ({
      ...one,
      seller: seatOf(lastSeat)?.name ?? null,
      zoho: seatOf(lastSeat)?.name ? null : (seatOf(lastSeat)?.zoho ?? null),
      deducted: deductions.filter((d) => d.customerId === one.customerId).reduce((sum, d) => sum + d.amount, 0),
      returns: returns.filter((r) => r.customerId === one.customerId).reduce((sum, r) => sum + r.count, 0),
      returnsCredit: returns.filter((r) => r.customerId === one.customerId).reduce((sum, r) => sum + r.credit, 0),
    })),
    seats: seats.map((one) => {
      const f = seatFigures.find((row) => row.seatId === one.seatId);
      return { seatId: one.seatId, title: one.title, lead: one.lead, name: one.name, zoho: one.zoho, chains: f?.chains ?? 0, soldMonth: f?.soldMonth ?? 0, owed: f?.owed ?? 0 };
    }),
    deductions: KINDS.map((kind) => ({
      kind,
      count: deductions.filter((d) => d.kind === kind).reduce((sum, d) => sum + d.count, 0),
      amount: deductions.filter((d) => d.kind === kind).reduce((sum, d) => sum + d.amount, 0),
    })).filter((one) => one.count > 0),
    returns: reasons.map((reason) => ({
      reason,
      count: returns.filter((r) => r.reason === reason).reduce((sum, r) => sum + r.count, 0),
      credit: returns.filter((r) => r.reason === reason).reduce((sum, r) => sum + r.credit, 0),
    })),
    listings,
  };
}

export async function saveListing(
  db: Database,
  me: Me,
  input: { customerId: number; medicineId: number; branches: number; listed: boolean; note?: string | null },
): Promise<void> {
  if (!mtPerson(me) && me.role !== "admin") throw new Refusal(403, "not_allowed", "Modern Trade keeps the chains' listings.");
  await db.execute(
    sql`insert into mt_listing (customer_id, medicine_id, branches, listed, note, added_by)
      values (${input.customerId}, ${input.medicineId}, ${input.branches}, ${input.listed}, ${input.note?.trim() || null}, ${me.id})`,
  );
}
