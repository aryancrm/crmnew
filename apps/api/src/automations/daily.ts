// Automations (docs/ERP-PLAN.md 7.3, decided 18 Nov on Aryan's word: "do what's right"): the CRM
// tells the right person when something needs them, without anyone asking. They only tell (in
// Messages → Needs you); they never change an order, a customer or the stock. Each event is told
// once (the notification's key), so running them again changes nothing. They run when the API
// starts and every 15 minutes with the other timers.
//
// - An order stuck at a step for two working days: the MedRep's team lead.
// - A customer's licence (LTO) expiring within 30 days, or expired: the MedRep holding their area
//   (else Management).
// - Each Monday: each MedRep's customers more than 60 days late, in one line.
// - Each Monday: batches on the shelves expiring within 90 days, to the stock desk.
// - From the 25th: a rep holding samples or gifts who hasn't counted them this month.
// - Each morning from 8: the CEO's summary of yesterday (sold, collected, owed, stuck, to decide).

import { type SQL, sql } from "drizzle-orm";
import { makeDueRecurring } from "../books/recurring";
import { type Database, rows } from "../db/index";
import { todayManila } from "../inventory/rules";
import { notify, peopleIn } from "../notify/service";
import { stuckNow } from "../orders/clock";
import { NEVER_STUCK } from "../orders/rules";
import { duesSql } from "../finance/dues";

const peso = (centavos: number) => `₱${Math.round(centavos / 100).toLocaleString("en-PH")}`;
const list = (values: readonly string[]): SQL => sql.join(values.map((value) => sql`${value}`), sql`, `);

/** Manila's clock now: the day, its hour, the weekday (Monday 1) and the ISO week's Monday. */
function manilaNow(now: Date) {
  const day = todayManila();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", hour12: false }).format(now));
  const weekday = ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const monday = new Date(Date.parse(`${day}T00:00:00Z`) - (weekday - 1) * 86_400_000).toISOString().slice(0, 10);
  return { day, hour, weekday, monday };
}

/** Who holds a customer: the person in the seat of the customer's area. */
const HOLDER = sql`(select h.person_id from seat s join seat_holder h on h.seat_id = s.id and h.kind = 'holder' and h.ends_on is null
  where s.area_id = c.area_id and s.active order by h.starts_on desc limit 1)`;

async function stuckOrders(db: Database): Promise<number> {
  const found = await rows<{ id: number; code: string; status: string; customer: string; lead: number | null; since: string }>(
    db,
    sql`select o.id::int as id, o.code, o.status, c.name as customer, to_char(o.status_since, 'YYYY-MM-DD') as since,
        (with recursive up as (select p.reports_to as id, 1 as depth from person p where p.id = o.medrep_id
            union all select p.reports_to, u.depth + 1 from person p join up u on p.id = u.id where u.depth < 12)
          select q.id::int from up join person q on q.id = up.id where q.active and q.role in ('team_lead', 'manager') order by up.depth limit 1) as lead
      from sales_order o join customer c on c.id = o.customer_id
      where o.status not in (${list(NEVER_STUCK)}) and ${stuckNow()}`,
  );
  let told = 0;
  for (const order of found) {
    if (!order.lead) continue;
    await notify(db, {
      to: [order.lead],
      kind: "team_stop",
      title: `${order.code} (${order.customer}) has not moved for two working days`,
      body: `Stuck at "${order.status.replace(/_/g, " ")}" since ${order.since}. Chase it with the desk holding it.`,
      link: `/orders/${order.id}`,
      orderId: order.id,
      key: `auto:stuck:${order.id}:${order.since}`,
    });
    told++;
  }
  return told;
}

async function licencesExpiring(db: Database, today: string): Promise<number> {
  const found = await rows<{ id: number; name: string; expires: string; holder: number | null }>(
    db,
    sql`select c.id::int as id, c.name, to_char(c.licence_expires, 'YYYY-MM-DD') as expires, ${HOLDER}::int as holder
      from customer c where c.active and c.licence_expires is not null and c.licence_expires <= ${today}::date + 30
        and c.licence_expires >= ${today}::date - 30 and c.kind in ('hospital', 'drugstore', 'distributor')`,
  );
  const management = await peopleIn(db, ["management"]);
  for (const one of found)
    await notify(db, {
      to: one.holder ? [one.holder] : management,
      kind: "licence_expiring",
      title: `${one.name}'s licence ${one.expires < today ? "expired" : "expires"} on ${one.expires}`,
      body: "Ask them for the renewed LTO and add it on their page: an order can't go out on an expired licence.",
      link: `/customers/${one.id}`,
      key: `auto:licence:${one.id}:${one.expires}`,
    });
  return found.length;
}

async function lateCustomers(db: Database, today: string, monday: string): Promise<number> {
  const found = await rows<{ holder: number; customers: number; owed: number }>(
    db,
    sql`select x.holder::int as holder, count(distinct x.customer_id)::int as customers, sum(x.balance)::float8 as owed
      from (select d.customer_id, d.balance, ${HOLDER} as holder from ${duesSql(today)} d join customer c on c.id = d.customer_id
        where d.late > 60 and not d.on_delivery) x
      where x.holder is not null group by x.holder`,
  );
  for (const one of found)
    await notify(db, {
      to: [one.holder],
      kind: "late_customers",
      title: `${one.customers} of your customers are over 60 days late: ${peso(one.owed)}`,
      body: "Collect before their next order: Customers owe us lists them, oldest first.",
      link: "/collections",
      key: `auto:late:${one.holder}:${monday}`,
    });
  return found.length;
}

async function expiringStock(db: Database, today: string, monday: string): Promise<number> {
  const [found] = await rows<{ batches: number; pieces: number; value: number }>(
    db,
    sql`select count(distinct b.id)::int as batches, coalesce(sum(s.qty), 0)::int as pieces, coalesce(sum(s.qty::bigint * coalesce(b.unit_cost, 0)), 0)::float8 as value
      from stock s join batch b on b.id = s.batch_id where s.qty > 0 and b.expires_on is not null and b.expires_on <= ${today}::date + 90`,
  );
  if (!found?.batches) return 0;
  await notify(db, {
    to: await peopleIn(db, ["inventory"]),
    kind: "stock_expiring",
    title: `${found.batches} batches on the shelves expire within 90 days (${found.pieces.toLocaleString("en-PH")} pieces, ${peso(found.value)} at cost)`,
    body: "Sell them first or plan their return: Stock by Age and Expiry lists them, soonest first.",
    link: "/books/reports/stock-aging",
    key: `auto:expiring:${monday}`,
  });
  return 1;
}

async function samplesToCount(db: Database, day: string): Promise<number> {
  if (Number(day.slice(8, 10)) < 25) return 0;
  const month = day.slice(0, 7);
  const found = await rows<{ id: number }>(
    db,
    sql`select distinct s.person_id::int as id from sample_stock s join person p on p.id = s.person_id and p.active
      where s.qty > 0 and not exists (select 1 from sample_move x where x.person_id = s.person_id and x.what = 'counted'
        and to_char(x.at at time zone 'Asia/Manila', 'YYYY-MM') = ${month})`,
  );
  for (const one of found)
    await notify(db, {
      to: [one.id],
      kind: "samples_count",
      title: "Count your samples and gifts before the month ends",
      body: "What you really hold, and why it differs.",
      link: "/me/samples",
      key: `auto:samples-count:${one.id}:${month}`,
    });
  return found.length;
}

async function ceoMorning(db: Database, day: string, hour: number): Promise<number> {
  if (hour < 8) return 0;
  const yesterday = new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const [figures] = await rows<{ sold: number; collected: number; owed: number; late: number; stuck: number }>(
    db,
    sql`select
        coalesce((select sum(total) from sale_invoice where status <> 'cancelled' and issued_on = ${yesterday}::date), 0)::float8 as sold,
        coalesce((select sum(amount) from payment where active and method not in ('points', 'withholding', 'credit', 'deduction') and paid_on = ${yesterday}::date), 0)::float8 as collected,
        coalesce((select sum(balance) from ${duesSql(day)} d where not d.on_delivery), 0)::float8 as owed,
        coalesce((select sum(balance) from ${duesSql(day)} d where not d.on_delivery and d.late > 0), 0)::float8 as late,
        (select count(*) from sales_order o where o.status not in (${list(NEVER_STUCK)}) and ${stuckNow()})::int as stuck`,
  );
  if (!figures) return 0;
  await notify(db, {
    to: await peopleIn(db, ["ceo"]),
    kind: "morning_summary",
    title: `Yesterday: ${peso(figures.sold)} sold, ${peso(figures.collected)} collected`,
    body: `Customers owe ${peso(figures.owed)} (${peso(figures.late)} past due). ${figures.stuck ? `${figures.stuck} orders stuck over two working days.` : "No order stuck."}`,
    link: "/",
    key: `auto:morning:${day}`,
  });
  return 1;
}

/** Runs every automation once; each tells an event only once, whenever it runs. */
export async function runAutomations(db: Database, now = new Date()): Promise<Record<string, number>> {
  const { day, hour, weekday, monday } = manilaNow(now);
  return {
    stuck: await stuckOrders(db),
    licences: await licencesExpiring(db, day),
    late: weekday === 1 ? await lateCustomers(db, day, monday) : 0,
    expiring: weekday === 1 ? await expiringStock(db, day, monday) : 0,
    samples: await samplesToCount(db, day),
    morning: await ceoMorning(db, day, hour),
    // Recurring expenses and bills taken over from Zoho (docs/BOOKS-PLAN.md B8).
    recurring: await makeDueRecurring(db, day),
  };
}
