// A seller's day, as the Hospital CHC Playbook runs it: today's pulse (four numbers with their
// light), the money to collect hospital by hospital (the oldest unpaid invoice, flagged at 60, 75
// and 90 days), and the 7 PM huddle declared to the coach, prefilled from the day's invoices,
// payments and visits. A coach reads the team's huddle: who declared, who is red, the blockers.

import { areasUnder, peopleUnder, seatsUnder } from "../org/scope";
import { type SQL, sql } from "drizzle-orm";
import { reorders } from "../customers/reorders";
import { type Database, rows } from "../db/index";
import { DEFAULT_SCHEDULE, isWorkDay } from "../hr/work-time";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { rxTelesales } from "../org/boxes";
import { inForce } from "../org/service";
import { careGroups } from "../rx/groups";
import { HOSPITAL } from "../scores/recipes";
import { measure } from "../scores/service";
import { teamSeats } from "../team/service";
import type { Collections, Huddle, HuddleInput, Me, Pulse, TeamHuddle } from "../types";

const LEADS = ["team_lead", "manager"];
const SELLERS = ["medrep", "online"];

/** Orders (alias `o`) that are this person's, or their team's for a lead. */
function whoseOrders(me: Me): SQL {
  return LEADS.includes(me.role)
    ? sql`(o.medrep_id in (with recursive t as (select id from person where id = ${me.id}
          union all select p.id from person p join t on p.reports_to = t.id) select id from t)
        or o.raised_by in (with recursive t as (select id from person where id = ${me.id}
          union all select p.id from person p join t on p.reports_to = t.id) select id from t))`
    : sql`(o.medrep_id = ${me.id} or o.raised_by = ${me.id})`;
}

/** The working day before a day (Monday to Saturday, less holidays). */
async function workDayBefore(db: Database, day: string): Promise<string> {
  const found = await rows<{ day: string }>(
    db,
    sql`select to_char(day, 'YYYY-MM-DD') as day from holiday where active and day between ${addDays(day, -14)}::date and ${day}::date`,
  );
  const holidays = new Set(found.map((row) => row.day));
  let back = addDays(day, -1);
  while (!isWorkDay(back, DEFAULT_SCHEDULE, holidays)) back = addDays(back, -1);
  return back;
}

/** Today's pulse: sales against the target on the month's pace, days to collect, hospitals not
 *  reordered, and whether the last working day had an invoice. Green, amber or red each. */
export async function pulse(db: Database, me: Me): Promise<Pulse> {
  if (!SELLERS.includes(me.role)) throw new Refusal(403, "not_allowed", "Today's pulse is a seller's.");
  const today = todayManila();
  const lastDay = await workDayBefore(db, today);
  const [{ values, notes }, slipping, invoicedRow] = await Promise.all([
    measure(db, me.id, HOSPITAL, today.slice(0, 7), today, true),
    reorders(db, me, { state: "late" }),
    rows<{ n: number; total: number }>(
      db,
      sql`select count(*)::int as n, coalesce(sum(i.total), 0)::float8 as total from invoice i join sales_order o on o.id = i.order_id
        where ${whoseOrders(me)} and i.status <> 'cancelled' and i.issued_on = ${lastDay}::date`,
    ),
  ]);
  const ist = values.ist ?? null;
  const dso = values.dso ?? null;
  const late = slipping.counts.filter((one) => one.state === "late" || one.state === "at_risk").reduce((sum, one) => sum + one.customers, 0);
  const invoiced = invoicedRow[0]?.n ?? 0;
  const round = (value: number | null) => (value === null ? null : Math.round(value));
  const dayWords = new Date(`${lastDay}T00:00:00Z`).toLocaleDateString("en-PH", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const salesTile: Pulse["tiles"][number] = {
    key: "sales",
    label: "Sales vs target",
    value: ist === null ? "No target" : `${round(ist)}%`,
    sub: notes.ist ?? "",
    tone: ist === null ? "none" : ist >= 91 ? "green" : ist >= 71 ? "amber" : "red",
    to: "/my/score",
  };
  const invoiceTile: Pulse["tiles"][number] = {
    key: "invoice",
    label: "Invoice on the last working day",
    value: invoiced ? "Yes" : "No",
    sub: invoiced ? `${invoiced} invoice${invoiced === 1 ? "" : "s"} on ${dayWords}` : `None on ${dayWords}: a zero-sales day`,
    tone: invoiced ? "green" : "red",
    to: "/orders?stage=all",
  };
  // MD Telesales (Rx Team & Training Playbook): the sales number, the refills due in 48 hours,
  // the care groups waiting for first contact (15 minutes), and the last working day's invoice.
  if (rxTelesales(me)) {
    const groups = await careGroups(db, me);
    const refills = slipping.counts.filter((one) => one.state === "soon" || one.state === "due").reduce((sum, one) => sum + one.customers, 0);
    const waiting = groups.counts.waiting + groups.counts.late;
    return {
      today,
      lastDay,
      tiles: [
        salesTile,
        {
          key: "refills",
          label: "Refills due",
          value: String(refills),
          sub: `${late} late or at risk too`,
          tone: late > 2 ? "red" : refills || late ? "amber" : "green",
          to: "/to-call?state=soon",
        },
        {
          key: "groups",
          label: "Groups waiting",
          value: String(waiting),
          sub: groups.counts.late ? `${groups.counts.late} past the 15 minutes` : "first contact within 15 minutes",
          tone: groups.counts.late ? "red" : waiting ? "amber" : "green",
          to: "/care-groups",
        },
        invoiceTile,
      ],
    };
  }
  return {
    today,
    lastDay,
    tiles: [
      {
        key: "sales",
        label: "Sales vs target",
        value: ist === null ? "No target" : `${round(ist)}%`,
        sub: notes.ist ?? "",
        tone: ist === null ? "none" : ist >= 91 ? "green" : ist >= 71 ? "amber" : "red",
        to: "/my/score",
      },
      {
        key: "dso",
        label: "Days to collect",
        value: dso === null ? "—" : `${round(dso)} days`,
        sub: notes.dso ?? "",
        tone: dso === null ? "none" : dso <= 70 ? "green" : dso < 90 ? "amber" : "red",
        to: "/collections",
      },
      {
        key: "reorder",
        label: "Not reordered",
        value: String(late),
        sub: "late or at risk against their usual gap",
        tone: late === 0 ? "green" : late <= 2 ? "amber" : "red",
        to: "/to-call?state=late",
      },
      {
        key: "invoice",
        label: "Invoice on the last working day",
        value: invoiced ? "Yes" : "No",
        sub: invoiced ? `${invoiced} invoice${invoiced === 1 ? "" : "s"} on ${dayWords}` : `None on ${dayWords}: a zero-sales day`,
        tone: invoiced ? "green" : "red",
        to: "/orders?stage=all",
      },
    ],
  };
}

/** Money to collect, hospital by hospital: what each owes, its oldest unpaid invoice and its age
 *  from the invoice day, flagged at 60, 75 and 90 days. A lead sees the team's. */
export async function collections(db: Database, me: Me): Promise<Collections> {
  if (![...SELLERS, ...LEADS, "ceo", "admin", "finance"].includes(me.role))
    throw new Refusal(403, "not_allowed", "Collections is the sellers' and their heads' list.");
  const today = todayManila();
  // A box picked on the team switch: the orders sold from its seats, the customers of its areas.
  const everyone = !me.unit && ["ceo", "admin", "finance"].includes(me.role);
  const whose = me.unit
    ? sql`(o.seat_id in ${seatsUnder(me.unit)} or (o.seat_id is null and o.medrep_id in ${peopleUnder(me.unit)}))`
    : everyone
      ? sql`true`
      : whoseOrders(me);
  // The people whose customers these are: me, or my whole team for a head.
  const team = LEADS.includes(me.role)
    ? sql`(with recursive t as (select id from person where id = ${me.id} union all select p.id from person p join t on p.reports_to = t.id) select id from t)`
    : sql`(select ${me.id}::bigint)`;
  // Unpaid invoices: the CRM's own, and Zoho's still open when Zoho was closed (the books), whose
  // seller is whoever holds the seat of the customer's area now.
  const found = await rows<Collections["rows"][number]>(
    db,
    sql`with inv as (
        select i.customer_id, i.code, '/orders/' || o.id as href, o.id::int as order_id, i.issued_on, i.due_on, (i.total - i.paid)::bigint as owed,
          (select p.name from person p where p.id = o.medrep_id) as seller
        from invoice i join sales_order o on o.id = i.order_id
        where i.status = 'open' and i.total > i.paid and not (i.terms = 'cod' and o.status <> 'completed') and ${whose}
        union all
        select d.customer_id, d.number, '/books/invoices/' || d.id, null::int, d.doc_date, d.due_date, round(d.balance * d.fx_rate)::bigint,
          coalesce((select p.name from seat s join seat_holder h on h.seat_id = s.id and h.ends_on is null and h.kind = 'holder' join person p on p.id = h.person_id
            where s.area_id = c.area_id order by h.starts_on desc limit 1), d.fields->>'salesperson_name', d.fields->>'Sales Person')
        from book_doc d join customer c on c.id = d.customer_id
        where d.kind = 'invoice' and d.zoho_id is not null and d.balance > 0 and d.status not in ('void', 'draft')
          and ${
            me.unit
              ? sql`c.area_id in ${areasUnder(me.unit)}`
              : everyone
              ? sql`true`
              : sql`c.area_id in (select s.area_id from seat s join seat_holder h on h.seat_id = s.id and h.ends_on is null where h.person_id in ${team} and s.area_id is not null)`
          }
      )
      select c.id::int as "customerId", c.name as customer, c.kind, c.phone,
        sum(inv.owed)::float8 as owed, count(*)::int as invoices,
        (array_agg(inv.code order by inv.issued_on))[1] as "oldestCode",
        (array_agg(inv.order_id order by inv.issued_on))[1]::int as "oldestOrderId",
        (array_agg(inv.href order by inv.issued_on))[1] as "oldestHref",
        to_char(min(inv.issued_on), 'YYYY-MM-DD') as "oldestOn",
        (${today}::date - min(inv.issued_on))::int as age,
        coalesce(max(${today}::date - inv.due_on) filter (where inv.due_on < ${today}::date), 0)::int as "daysLate",
        (array_agg(inv.seller order by inv.issued_on))[1] as seller
      from inv join customer c on c.id = inv.customer_id
      group by c.id, c.name, c.kind, c.phone
      order by min(inv.issued_on), sum(inv.owed) desc limit 300`,
  );
  const flag = (age: number): Collections["rows"][number]["flag"] => (age >= 90 ? "d90" : age >= 75 ? "d75" : age >= 60 ? "d60" : "ok");
  const withFlags = found.map((row) => ({ ...row, flag: flag(row.age) }));
  const sum = (key: Collections["rows"][number]["flag"]) => withFlags.filter((row) => row.flag === key).reduce((total, row) => total + row.owed, 0);
  return {
    today,
    total: withFlags.reduce((total, row) => total + row.owed, 0),
    buckets: [
      { key: "ok", label: "Under 60 days", amount: sum("ok") },
      { key: "d60", label: "60–74 days", amount: sum("d60") },
      { key: "d75", label: "75–89 days", amount: sum("d75") },
      { key: "d90", label: "90 days and over", amount: sum("d90") },
    ],
    rows: withFlags,
    scope: me.unit
      ? `${(await rows<{ name: string }>(db, sql`select name from org_unit where id = ${me.unit}`))[0]?.name ?? "The team"}'s customers`
      : LEADS.includes(me.role)
        ? "My team's customers"
        : ["ceo", "admin", "finance"].includes(me.role)
          ? "Every customer"
          : "My customers",
  };
}

/** A day's actual numbers for a person: invoiced, collected (payments on their invoices), visits. */
async function actualsOf(db: Database, personIds: number[], day: string) {
  if (!personIds.length) return new Map<number, Huddle["actual"]>();
  const list = sql.join(personIds.map((id) => sql`${id}`), sql`, `);
  const found = await rows<{ personId: number; sales: number; invoices: number; collected: number; visits: number }>(
    db,
    sql`select p.id::int as "personId",
        coalesce((select sum(i.total) from invoice i join sales_order o on o.id = i.order_id
          where (o.medrep_id = p.id or o.raised_by = p.id) and i.status <> 'cancelled' and i.issued_on = ${day}::date), 0)::float8 as sales,
        (select count(*) from invoice i join sales_order o on o.id = i.order_id
          where (o.medrep_id = p.id or o.raised_by = p.id) and i.status <> 'cancelled' and i.issued_on = ${day}::date)::int as invoices,
        (coalesce((select sum(pm.amount) from payment pm join invoice i on i.id = pm.invoice_id join sales_order o on o.id = i.order_id
          where (o.medrep_id = p.id or o.raised_by = p.id) and pm.paid_on = ${day}::date), 0)
          -- And what was taken here on Zoho's unpaid invoices of the customers of the seller's areas.
          + coalesce((select sum(k.amount) from book_doc r join book_link k on k.from_doc = r.id join book_doc i on i.id = k.to_doc and i.kind = 'invoice'
              join customer c on c.id = i.customer_id
            where r.kind = 'customer_payment' and r.zoho_id is null and r.status <> 'void' and r.doc_date = ${day}::date
              and c.area_id in (select s.area_id from seat s join seat_holder h on h.seat_id = s.id and h.ends_on is null where h.person_id = p.id)), 0))::float8 as collected,
        (select count(*) from visit v where v.person_id = p.id and v.status = 'done' and v.day = ${day}::date)::int as visits
      from person p where p.id in (${list})`,
  );
  return new Map(
    found.map((row) => [row.personId, { sales: row.sales, collected: row.collected, visits: row.visits, invoiced: row.invoices > 0 }]),
  );
}

type Declared = NonNullable<Huddle["declared"]>;
const declaredOf = (personIds: number[], day: string) =>
  sql`select person_id::int as "personId", sales::float8 as sales, collected::float8 as collected, visits, invoiced, blocker, tomorrow,
      to_char(declared_at at time zone 'Asia/Manila', 'HH24:MI') as at
    from huddle where day = ${day}::date and person_id in (${sql.join(personIds.map((id) => sql`${id}`), sql`, `)})`;

/** The 7 PM huddle is the Hospital CHC Playbook's: the Hospital Division's CHCs declare it (not its
 *  anesthesia telesales, PAP officer or government bidding coachee: their work is not the CHC's). */
const huddleSeller = (me: Me) => me.role === "medrep" && me.channel?.code === "HOSP" && !/bidding/i.test(me.title ?? "");

/** My huddle for today: the numbers as the data has them, and what I declared. */
export async function myHuddle(db: Database, me: Me): Promise<Huddle> {
  if (!huddleSeller(me)) throw new Refusal(403, "not_allowed", "The 7 PM huddle is the Hospital CHCs' (the Hospital Division's playbook).");
  const today = todayManila();
  const [actual, declared, coach] = await Promise.all([
    actualsOf(db, [me.id], today),
    rows<Declared & { personId: number }>(db, declaredOf([me.id], today)),
    rows<{ name: string }>(db, sql`select b.name from person p join person b on b.id = p.reports_to where p.id = ${me.id}`),
  ]);
  return {
    day: today,
    coach: coach[0]?.name ?? null,
    actual: actual.get(me.id) ?? { sales: 0, collected: 0, visits: 0, invoiced: false },
    declared: declared[0] ?? null,
  };
}

export async function declareHuddle(db: Database, me: Me, input: HuddleInput): Promise<void> {
  if (!huddleSeller(me)) throw new Refusal(403, "not_allowed", "The 7 PM huddle is the Hospital CHCs'.");
  if (!input.invoiced && !input.blocker?.trim())
    throw new Refusal(400, "invalid", "No invoice today: say what stood in the way.", "blocker");
  const today = todayManila();
  const [seat] = await rows<{ id: number }>(
    db,
    sql`select seat_id::int as id from seat_holder h where h.person_id = ${me.id} and h.kind = 'holder' and ${inForce("h", today)}
      order by h.starts_on desc limit 1`,
  );
  await db.execute(
    sql`insert into huddle (person_id, day, seat_id, sales, collected, visits, invoiced, blocker, tomorrow)
      values (${me.id}, ${today}::date, ${seat?.id ?? null}, ${input.sales}, ${input.collected}, ${input.visits}, ${input.invoiced},
        ${input.blocker?.trim() || null}, ${input.tomorrow?.trim() || null})
      on conflict (person_id, day) do update set sales = excluded.sales, collected = excluded.collected, visits = excluded.visits,
        invoiced = excluded.invoiced, blocker = excluded.blocker, tomorrow = excluded.tomorrow, declared_at = now()`,
  );
}

/** The team's huddle for a day: each seller under the lead, what they declared (or not yet), the
 *  day's actual numbers, and red when there was no invoice; three evenings running without one
 *  is the playbook's "go with them tomorrow". */
export async function teamHuddle(db: Database, me: Me, asked: { day?: string }): Promise<TeamHuddle> {
  if (![...LEADS, "ceo", "admin"].includes(me.role)) throw new Refusal(403, "not_allowed", "The team's huddle is for leads.");
  const today = todayManila();
  const day = asked.day && /^\d{4}-\d{2}-\d{2}$/.test(asked.day) && asked.day <= today ? asked.day : today;
  const { seatIds } = await teamSeats(db, me, null);
  const people = seatIds.length
    ? await rows<{ personId: number; name: string; seat: string; area: string | null; unit: string }>(
        db,
        sql`select distinct on (h.person_id) h.person_id::int as "personId", p.name, s.title as seat, a.name as area, u.name as unit
          from seat s join seat_holder h on h.seat_id = s.id and h.kind = 'holder' and ${inForce("h", day)}
            join person p on p.id = h.person_id join org_unit u on u.id = s.unit_id left join area a on a.id = s.area_id
          where s.id in (${sql.join(seatIds.map((id) => sql`${id}`), sql`, `)}) and not s.lead and s.module = 'medrep'
            and h.person_id <> ${me.id}
            -- The huddle's people: the Hospital Division's CHCs.
            and (select ch.code from channel ch where ch.id = a.channel_id) = 'HOSP' and s.title not ilike '%bidding%'
          order by h.person_id, h.starts_on desc`,
      )
    : [];
  const ids = people.map((one) => one.personId);
  const back1 = await workDayBefore(db, day);
  const back2 = await workDayBefore(db, back1);
  const [actual, declared, before1, before2] = await Promise.all([
    actualsOf(db, ids, day),
    ids.length ? rows<Declared & { personId: number }>(db, declaredOf(ids, day)) : Promise.resolve([]),
    actualsOf(db, ids, back1),
    actualsOf(db, ids, back2),
  ]);
  const rowsOut = people
    .map((one) => {
      const today = actual.get(one.personId) ?? { sales: 0, collected: 0, visits: 0, invoiced: false };
      const said = declared.find((row) => row.personId === one.personId) ?? null;
      const threeDry = !today.invoiced && !before1.get(one.personId)?.invoiced && !before2.get(one.personId)?.invoiced;
      return { ...one, actual: today, declared: said, red: !today.invoiced, threeDry };
    })
    .sort((a, b) => Number(b.threeDry) - Number(a.threeDry) || Number(b.red) - Number(a.red) || a.name.localeCompare(b.name));
  return {
    day,
    today,
    declared: rowsOut.filter((row) => row.declared).length,
    rows: rowsOut,
  };
}
