// My KPIs, the hub's way (Aryan, 20 Nov: "the KPI comes from a formula in the hub's code"; the
// hub's services/kpiService.js and controllers/kpi.controller.js, docs/PLAN.md 23). No points or
// bands: a person's month is sales against target plus counts, and a lead's team the same summed.
//
//  - Sales without VAT: each invoiced line's amount ÷ 1.12 when it carries 12% VAT (else as it
//    is); Zoho's history by its own line totals. The same lines as Sales performance
//    (sales/performance.ts linesSql), so the two pages agree. With VAT = the invoices' totals;
//    VAT = the difference.
//  - % of target = sales without VAT ÷ target × 100, one decimal; no target, no %.
//  - Orders invoiced: the invoices in the month (one per order here; each of Zoho's). New
//    customers: invoiced orders that are their customer's first ever (an earlier order here, a
//    Zoho order or invoice before it means not new; a Zoho invoice, its customer's first invoice
//    ever). Orders raised: orders placed in the month (not drafts, not cancelled), here and in
//    Zoho (not void). Orders held: orders put on hold or flagged in the month. Waiting:
//    orders placed (last 90 days) still waiting for Management's approval, or held, with no
//    invoice: shown, never counted (here the invoice is made when Management approves).
//  - Whose sale: the person holding the order's seat on the day of the invoice (the territory's
//    owner), else the order's MedRep; who typed an order for someone else sees it as "entered for
//    others".
//  - Team (a lead, a manager, a head; the CEO the company): their own plus everyone in the seats
//    under them on the company tree, or the box picked on the team switch. Team target = everyone's
//    targets + the targets of the empty seats under them. Nothing counted twice.
//  - A day (Today, Yesterday, a date): the same sales without VAT for invoices of that day.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { creditedTo, inForce } from "../org/service";
import { teamSeats } from "../team/service";
import type { KpiDay, KpiFigures, KpiPanel, Me } from "../types";
import { invoicesSql } from "./invoices";

const WHOLE = ["ceo", "admin"];
const isDay = (value?: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
const lastOf = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
const ids = (list: number[]) => sql.join(list.map((id) => sql`${id}`), sql`, `);

/** Whose figures: one person (their own), or a team (people and the seats under the lead). */
type Scope =
  | { kind: "own"; personId: number }
  | { kind: "team"; people: number[]; seats: number[] }
  // The whole company (the CEO's and the Admin's, no box picked): every sale, a Zoho name not tied to
  // a seat yet included, as the CEO's Home counts it.
  | { kind: "all"; people: number[]; seats: number[] };

/** The scope as a test on an invoice row (alias x) and on an order (alias o). */
function tests(scope: Scope, today: string): { invoice: SQL; order: SQL } {
  if (scope.kind === "own")
    return { invoice: sql`x.person_id = ${scope.personId}`, order: sql`${creditedTo(today)} = ${scope.personId}` };
  if (scope.kind === "all") return { invoice: sql`true`, order: sql`true` };
  const people = scope.people.length ? sql`in (${ids(scope.people)})` : sql`in (null)`;
  const seats = scope.seats.length ? sql`in (${ids(scope.seats)})` : sql`in (null)`;
  return {
    invoice: sql`(x.seat_id ${seats} or x.person_id ${people})`,
    order: sql`(o.seat_id ${seats} or ${creditedTo(today)} ${people})`,
  };
}

/** The month's figures for a scope, up to `upTo`. */
async function figures(db: Database, scope: Scope, month: string, upTo: string, today: string): Promise<KpiFigures> {
  const first = `${month}-01`;
  const t = tests(scope, today);
  const placed = sql`(coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Manila')::date`;
  // Zoho's orders in the days, each with its seat and the person it counts for (the seat's holder
  // on the order's day, else its first holder after), as Zoho's invoices are credited: the company
  // still orders in Zoho, so "Orders raised" counts them too, as the Home's "How the orders came"
  // and Whole business do (28 Nov, PLAN 275: it said 0 beside 328).
  const zohoOrders = sql`select zs.seat_id,
      coalesce((select h.person_id from seat_holder h where h.seat_id = zs.seat_id and h.kind = 'holder' and h.starts_on <= p.ordered_on
          and (h.ends_on is null or h.ends_on >= p.ordered_on) order by h.starts_on desc limit 1),
        (select h.person_id from seat_holder h where h.seat_id = zs.seat_id and h.kind = 'holder' and h.starts_on > p.ordered_on
          order by h.starts_on, h.id limit 1)) as person_id
    from past_order p left join zoho_seller zs on zs.name = p.seller
    where p.status <> 'void' and p.ordered_on between ${first}::date and ${upTo}::date`;
  const [sold, counts, perDay] = await Promise.all([
    rows<{ withVat: number; sales: number; invoices: number; newCustomers: number }>(
      db,
      // New customers: an invoice here that is its customer's first ever order (as before), or a
      // Zoho invoice that is its customer's first ever invoice, with no order here before it (28 Nov,
      // PLAN 275: Zoho's invoices were left out, so the Home said 0 new customers).
      sql`select coalesce(sum(x.total), 0)::float8 as "withVat", coalesce(sum(x.net), 0)::float8 as sales, count(*)::int as invoices,
          count(distinct x.customer_id) filter (where (x.source = 'crm'
            and not exists (select 1 from sales_order e where e.customer_id = x.customer_id and e.id <> x.order_id
              and e.status not in ('draft', 'cancelled') and (e.created_at < x.order_at or (e.created_at = x.order_at and e.id < x.order_id)))
            and not exists (select 1 from past_order p where p.customer_id = x.customer_id and p.status <> 'void'
              and p.ordered_on < (x.order_at at time zone 'Asia/Manila')::date)
            and not exists (select 1 from book_doc b where b.customer_id = x.customer_id and b.kind = 'invoice' and b.zoho_id is not null
              and b.status not in ('draft', 'void') and b.doc_date < (x.order_at at time zone 'Asia/Manila')::date))
          or (x.source = 'zoho'
            and not exists (select 1 from book_doc b where b.customer_id = x.customer_id and b.kind = 'invoice' and b.zoho_id is not null
              and b.status not in ('draft', 'void') and b.voided_at is null and (b.doc_date < x.day or (b.doc_date = x.day and b.id < x.id)))
            and not exists (select 1 from sales_order e where e.customer_id = x.customer_id and e.status not in ('draft', 'cancelled')
              and (e.created_at at time zone 'Asia/Manila')::date < x.day)))::int as "newCustomers"
        from (${invoicesSql(first, upTo)}) x where ${t.invoice}`,
    ),
    rows<{ raised: number; held: number; waiting: number; waitingSales: number }>(
      db,
      sql`select
          ((select count(*) from sales_order o where ${t.order} and o.status not in ('draft', 'cancelled')
            and ${placed} between ${first}::date and ${upTo}::date)
          + (select count(*) from (${zohoOrders}) x where ${t.invoice}))::int as raised,
          (select count(distinct st.order_id) from order_step st join sales_order o on o.id = st.order_id
            where ${t.order} and st.status in ('on_hold', 'exception')
              and (st.entered_at at time zone 'Asia/Manila')::date between ${first}::date and ${upTo}::date)::int as held,
          (select count(*) from sales_order o where ${t.order} and o.status in ('pending_approval', 'on_hold', 'exception')
            and ${placed} >= (${today}::date - 90)
            and not exists (select 1 from invoice i where i.order_id = o.id and i.status <> 'cancelled'))::int as waiting,
          coalesce((select sum((select coalesce(sum(round(oi.qty::numeric * oi.unit_price / case when coalesce(oi.vat_then, m.vat) = 'vat12' then 1.12 else 1 end)), 0)
              from order_item oi join medicine m on m.id = oi.medicine_id where oi.order_id = o.id))
            from sales_order o where ${t.order} and o.status in ('pending_approval', 'on_hold', 'exception')
              and ${placed} >= (${today}::date - 90)
              and not exists (select 1 from invoice i where i.order_id = o.id and i.status <> 'cancelled')), 0)::float8 as "waitingSales"`,
    ),
    // The same sales, day by day (the KPI card's bars).
    rows<{ day: number; sales: number }>(
      db,
      sql`select extract(day from x.day)::int as day, coalesce(sum(x.net), 0)::float8 as sales
        from (${invoicesSql(first, upTo)}) x where ${t.invoice} group by 1`,
    ),
  ]);
  const daily = Array.from({ length: Number(lastOf(month).slice(8, 10)) }, () => 0);
  for (const one of perDay) if (one.day >= 1 && one.day <= daily.length) daily[one.day - 1] = one.sales;
  // Targets: the person's; a team's, everyone's plus the empty seats' under the lead.
  let target = 0;
  let vacantTarget = 0;
  let people = 1;
  let peopleWithTarget = 0;
  if (scope.kind === "own") {
    const [own] = await rows<{ amount: number | null }>(
      db,
      sql`select amount::float8 as amount from sales_target where person_id = ${scope.personId} and month = ${first}::date`,
    );
    target = own?.amount ?? 0;
    peopleWithTarget = own?.amount ? 1 : 0;
  } else {
    people = scope.people.length;
    // The company's: every target set and every empty seat's, as the CEO's Home counts it.
    const personTest = scope.kind === "all" ? sql`true` : scope.people.length ? sql`t.person_id in (${ids(scope.people)})` : sql`false`;
    const seatTest = scope.kind === "all" ? sql`true` : scope.seats.length ? sql`s.id in (${ids(scope.seats)})` : sql`false`;
    const [team] = await rows<{ target: number; withTarget: number; vacant: number }>(
      db,
      sql`select
          coalesce((select sum(t.amount) from sales_target t where t.month = ${first}::date
            and ${personTest}), 0)::float8 as target,
          (select count(*) from sales_target t where t.month = ${first}::date and t.amount > 0
            and ${personTest})::int as "withTarget",
          coalesce((select sum(t.amount) from seat_target t join seat s on s.id = t.seat_id and s.active
            where t.month = ${first}::date and ${seatTest}
              and not exists (select 1 from seat_holder h where h.seat_id = s.id and h.kind = 'holder'
                and h.starts_on <= ${lastOf(month)}::date and (h.ends_on is null or h.ends_on >= ${first}::date))), 0)::float8 as vacant`,
    );
    vacantTarget = team?.vacant ?? 0;
    target = (team?.target ?? 0) + vacantTarget;
    peopleWithTarget = team?.withTarget ?? 0;
  }
  const s = sold[0] as NonNullable<(typeof sold)[number]>;
  const c = counts[0] as NonNullable<(typeof counts)[number]>;
  return {
    people,
    peopleWithTarget,
    target: target > 0 ? target : null,
    vacantTarget,
    sales: s.sales,
    withVat: s.withVat,
    vat: Math.max(0, s.withVat - s.sales),
    percent: target > 0 ? Math.round((s.sales / target) * 1000) / 10 : null,
    ordersInvoiced: s.invoices,
    newCustomers: s.newCustomers,
    ordersRaised: c.raised,
    ordersHeld: c.held,
    waitingOrders: c.waiting,
    waitingSales: c.waitingSales,
    daily,
  };
}

/** One day's sales without VAT for a scope, with the invoices behind it. */
async function dayOf(db: Database, scope: Scope, day: string, today: string): Promise<{ total: KpiDay; rows: KpiPanel["dayOrders"] }> {
  const t = tests(scope, today);
  const found = await rows<KpiPanel["dayOrders"][number]>(
    db,
    sql`select x.order_id::int as "orderId", coalesce(x.order_code, x.invoice) as code, x.invoice, coalesce(c.name, '') as customer,
        x.net::float8 as sales, p.name as person
      from (${invoicesSql(day, day)}) x left join customer c on c.id = x.customer_id left join person p on p.id = x.person_id
      where ${t.invoice} order by x.net desc`,
  );
  return { total: { sales: found.reduce((sum, row) => sum + row.sales, 0), orders: found.length }, rows: found };
}

/** GET /api/kpis/me: My Own KPI and, for anyone with people under them, My Team KPI; the CEO and
 *  the Admin see the company (or the box picked on the team switch). With a day: that day's sales. */
export async function myKpiPanel(db: Database, me: Me, asked: { month?: string; day?: string }): Promise<KpiPanel> {
  const today = todayManila();
  const day = isDay(asked.day) && (asked.day as string) <= today ? (asked.day as string) : null;
  const askedMonth = asked.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked.month) ? asked.month : null;
  const month = day ? day.slice(0, 7) : askedMonth && askedMonth <= today.slice(0, 7) ? askedMonth : today.slice(0, 7);
  if (askedMonth && askedMonth > today.slice(0, 7)) throw new Refusal(400, "invalid", "That month has not started yet.", "month");
  const running = month === today.slice(0, 7);
  const upTo = running ? today : lastOf(month);
  const whole = WHOLE.includes(me.role);

  // The team: the seats under them on the company tree (or the box picked), their holders and them.
  let team: Scope | null = null;
  let label = whole ? "The company" : "My team";
  try {
    const view = await teamSeats(db, me, me.unit ?? null);
    if (view.seatIds.length) {
      const holders = await rows<{ personId: number }>(
        db,
        sql`select distinct h.person_id::int as "personId" from seat_holder h
          where h.kind = 'holder' and h.seat_id in (${ids(view.seatIds)}) and ${inForce("h", upTo)}`,
      );
      const people = [...new Set([...(whole ? [] : [me.id]), ...holders.map((one) => one.personId)])];
      team = { kind: whole && !me.unit ? "all" : "team", people, seats: view.seatIds };
      if (me.unit) {
        const [unit] = await rows<{ name: string }>(db, sql`select name from org_unit where id = ${me.unit}`);
        if (unit) label = unit.name;
      }
    }
  } catch {
    team = null;
  }
  // The CEO and the Admin don't sell: their panel is the company's.
  const own: Scope | null = whole ? null : { kind: "own", personId: me.id };

  const [ownFigures, teamFigures, ownDay, teamDay] = await Promise.all([
    own ? figures(db, own, month, upTo, today) : Promise.resolve(null),
    team ? figures(db, team, month, upTo, today) : Promise.resolve(null),
    own && day ? dayOf(db, own, day, today) : Promise.resolve(null),
    team && day ? dayOf(db, team, day, today) : Promise.resolve(null),
  ]);
  // What they typed for others (counted on the others'), and what others typed for them.
  let enteredForOthers = 0;
  let enteredForMe = 0;
  if (own) {
    const [typed] = await rows<{ others: number; forMe: number }>(
      db,
      sql`select coalesce(sum(x.net) filter (where x.raised_by = ${me.id} and x.person_id is distinct from ${me.id}), 0)::float8 as others,
          coalesce(sum(x.net) filter (where x.person_id = ${me.id} and x.raised_by is not null and x.raised_by <> ${me.id}), 0)::float8 as "forMe"
        from (${invoicesSql(`${month}-01`, upTo)}) x where x.source = 'crm'`,
    );
    enteredForOthers = typed?.others ?? 0;
    enteredForMe = typed?.forMe ?? 0;
  }
  return {
    month,
    today,
    running,
    day,
    own: ownFigures ? { ...ownFigures, enteredForOthers, enteredForMe } : null,
    team: teamFigures ? { ...teamFigures, label } : null,
    ownDay: ownDay?.total ?? null,
    teamDay: teamDay?.total ?? null,
    // A lead's day lists the team's invoices (theirs among them); a seller's, their own.
    dayOrders: (team ? teamDay?.rows : ownDay?.rows) ?? [],
  };
}
