// A B2C CHC's day (B2C CHC Playbook v1.3): the 8:00 morning pulse (enquiries waiting, new
// prospects not answered, the refill-due list, the last working day's invoice, uncoded
// cancellations, late replies today), the enquiries waiting for a reply with the 15-minute clock,
// the refills due by each patient's own rhythm, and the orders by where they stand (quoted, at
// Finance, to ship, day-3 check-ins due). A reply is late when an enquiry's first message of a
// turn waits more than 15 minutes in working hours; three late in a day and the coach is told.
// The coach reads each B2C CHC's desk now.

import { type SQL, sql } from "drizzle-orm";
import { reorders } from "../customers/reorders";
import { type Database, rows } from "../db/index";
import { DEFAULT_SCHEDULE, isWorkDay } from "../hr/work-time";
import { onlineDesk, Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { inForce } from "../org/service";
import { teamSeats } from "../team/service";
import type { B2cDay, B2cTeam, Me } from "../types";

export const REPLY_MINUTES = 15;
const LATE_ALARM = 3;
/** A cancellation with no reason given carries this default (orders/service.ts). */
const UNCODED = "Cancelled by the MedRep";

const startOf = (day: string) => sql`(${day}::date::timestamp at time zone 'Asia/Manila')`;
const clock = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

async function lastWorkDay(db: Database, today: string): Promise<string> {
  const found = await rows<{ day: string }>(
    db,
    sql`select to_char(day, 'YYYY-MM-DD') as day from holiday where active and day between ${addDays(today, -14)}::date and ${today}::date`,
  );
  const holidays = new Set(found.map((row) => row.day));
  let day = addDays(today, -1);
  while (!isWorkDay(day, DEFAULT_SCHEDULE, holidays)) day = addDays(day, -1);
  return day;
}

/** Late replies on a day for the leads of these people: a turn's first inbound message in working
 *  hours that waited more than 15 minutes for our answer (or is still waiting past them). */
async function lateReplies(db: Database, personIds: number[], day: string): Promise<Map<number, number>> {
  if (!personIds.length) return new Map();
  const from = clock(DEFAULT_SCHEDULE.start);
  const to = clock(DEFAULT_SCHEDULE.end);
  const found = await rows<{ personId: number; late: number }>(
    db,
    sql`with ms as (
        select l.assigned_to as person, m.lead_id, m.at, m.direction,
          lag(m.direction) over (partition by m.lead_id order by m.at) as prev
        from lead_message m join lead l on l.id = m.lead_id
        where l.assigned_to in (${sql.join(personIds.map((id) => sql`${id}`), sql`, `)})
          and m.at >= ${startOf(day)} - interval '1 day' and m.at < ${startOf(day)} + interval '1 day'
      ),
      turns as (
        select person, lead_id, at from ms
        where direction = 'in' and (prev is null or prev = 'out') and at >= ${startOf(day)}
          and extract(hour from at at time zone 'Asia/Manila') * 60 + extract(minute from at at time zone 'Asia/Manila') between ${from} and ${to}
      )
      select t.person::int as "personId",
        count(*) filter (where coalesce((select min(o.at) from lead_message o where o.lead_id = t.lead_id and o.direction = 'out' and o.at > t.at), now())
          - t.at > ${`${REPLY_MINUTES} minutes`}::interval)::int as late
      from turns t group by t.person`,
  );
  return new Map(found.map((row) => [row.personId, row.late]));
}

const mine = (me: Me): SQL => sql`(o.medrep_id = ${me.id} or o.raised_by = ${me.id})`;

export async function b2cDay(db: Database, me: Me): Promise<B2cDay> {
  if (!onlineDesk(me)) throw new Refusal(403, "not_allowed", "This is the B2C CHC's day (the Online desk).");
  const today = todayManila();
  const lastDay = await lastWorkDay(db, today);
  const [waiting, soon, due, counts, late, day3] = await Promise.all([
    rows<B2cDay["waiting"][number]>(
      db,
      sql`select l.id::int as "leadId", l.code, coalesce(l.patient_name, l.name) as name, l.source,
          l.last_message as "lastMessage", l.last_inbound_at as "since",
          round(extract(epoch from now() - l.last_inbound_at) / 60)::int as minutes,
          (l.customer_id is null) as prospect, (l.assigned_to is null) as unassigned
        from lead l
        where l.desk = 'online' and l.state = 'open' and l.awaiting_reply and l.last_inbound_at is not null
          and (l.assigned_to = ${me.id} or l.assigned_to is null)
        order by l.last_inbound_at limit 50`,
    ),
    reorders(db, me, { state: "soon" }),
    reorders(db, me, { state: "due" }),
    rows<{ invoices: number; uncoded: number; quoted: number; atFinance: number; toShip: number }>(
      db,
      sql`select
          (select count(*) from invoice i join sales_order o on o.id = i.order_id
            where ${mine(me)} and i.status <> 'cancelled' and i.issued_on = ${lastDay}::date)::int as invoices,
          (select count(*) from sales_order o where ${mine(me)} and o.status = 'cancelled'
            and o.updated_at >= ${startOf(lastDay)} and (o.flag_reason is null or o.flag_reason = ${UNCODED}))::int as uncoded,
          (select count(*) from lead l where l.assigned_to = ${me.id} and l.state = 'open' and l.quote_lines <> '[]'::jsonb
            and not exists (select 1 from sales_order o where o.lead_id = l.id and o.status <> 'cancelled'))::int as quoted,
          (select count(*) from sales_order o where ${mine(me)} and o.status in ('pending_approval', 'finance_check', 'ready_for_invoice'))::int as "atFinance",
          (select count(*) from sales_order o where ${mine(me)} and o.status in ('ready_for_dispatch', 'packing', 'shipped'))::int as "toShip"`,
    ),
    lateReplies(db, [me.id], today),
    rows<B2cDay["day3"][number]>(
      db,
      sql`select o.id::int as "orderId", o.code, c.id::int as "customerId", c.name as customer, c.phone,
          to_char(o.delivered_on, 'YYYY-MM-DD') as "deliveredOn"
        from sales_order o join customer c on c.id = o.customer_id
        where ${mine(me)} and o.status = 'completed' and o.delivered_on between ${addDays(today, -3)}::date and ${addDays(today, -1)}::date
          and not exists (select 1 from order_event e where e.order_id = o.id and e.kind = 'day3_checkin')
        order by o.delivered_on limit 20`,
    ),
  ]);
  const c = counts[0] as NonNullable<(typeof counts)[0]>;
  const lateToday = late.get(me.id) ?? 0;
  const prospects = waiting.filter((row) => row.prospect).length;
  const refills = soon.rows.length + due.rows.length;
  const dayWords = new Date(`${lastDay}T00:00:00Z`).toLocaleDateString("en-PH", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return {
    today,
    replyMinutes: REPLY_MINUTES,
    pulse: [
      {
        key: "waiting",
        question: "Enquiries waiting for a reply",
        value: String(waiting.length),
        green: waiting.length === 0,
        action: waiting.length ? "Answer every one before the refill list: a customer waiting = lost sales." : "All answered.",
        to: "/leads",
      },
      {
        key: "prospects",
        question: "New prospects not answered",
        value: String(prospects),
        green: prospects === 0,
        action: prospects ? "New prospects first: they have the shortest patience. Log each one's contact before 9:00." : "Every prospect answered.",
        to: "/leads",
      },
      {
        key: "refills",
        question: "Refill-due list",
        value: String(refills),
        green: true,
        action: refills ? "Call or message every one before 12:00 noon: no filtering." : "No refill due today or in two days.",
        to: "/to-call?state=soon",
      },
      {
        key: "invoice",
        question: `An invoice on ${dayWords}`,
        value: c.invoices ? "Yes" : "No",
        green: c.invoices > 0,
        action: c.invoices ? `${c.invoices} invoice${c.invoices === 1 ? "" : "s"}.` : "A zero-sales day: today's first task is a call to a lapsed customer before noon.",
        to: "/to-call?state=late",
      },
      {
        key: "uncoded",
        question: "Cancellations without a reason",
        value: String(c.uncoded),
        green: c.uncoded === 0,
        action: c.uncoded ? "Code every cancellation's reason before 9:00." : "Every cancellation coded.",
        to: "/orders?stage=all",
      },
      {
        key: "late",
        question: "Replies past 15 minutes today",
        value: String(lateToday),
        green: lateToday === 0,
        action: lateToday >= LATE_ALARM ? "Three or more: your coach is told today." : lateToday ? "Keep every first reply within 15 minutes." : "Every reply in time.",
        to: "/leads",
      },
    ],
    waiting,
    refills: [...due.rows, ...soon.rows].slice(0, 10),
    orders: { quoted: c.quoted, atFinance: c.atFinance, toShip: c.toShip, day3: day3.length },
    day3,
  };
}

/** The day-3 check-in is done: the customer has the medicine; the next refill was asked. */
export async function day3Done(db: Database, me: Me, orderId: number, note: string): Promise<void> {
  if (!onlineDesk(me)) throw new Refusal(403, "not_allowed", "The B2C CHC does the day-3 check-in.");
  const [order] = await rows<{ id: number }>(
    db,
    sql`select o.id::int as id from sales_order o where o.id = ${orderId} and ${mine(me)} and o.status = 'completed'`,
  );
  if (!order) throw new Refusal(404, "not_found", "Not one of your delivered orders.");
  await db.execute(
    sql`insert into order_event (order_id, kind, message, by_person) values (${orderId}, 'day3_checkin', ${`Day-3 check-in: ${note}`}, ${me.id})`,
  );
}

/** The coach's B2C desk now: each B2C CHC under them with enquiries waiting, late replies today,
 *  today's invoices and the last working day's. */
export async function b2cTeam(db: Database, me: Me): Promise<B2cTeam> {
  if (!["team_lead", "manager", "ceo", "admin"].includes(me.role)) throw new Refusal(403, "not_allowed", "The B2C desk is the coaches' view.");
  const today = todayManila();
  const lastDay = await lastWorkDay(db, today);
  const { seatIds } = await teamSeats(db, me, me.unit ?? null);
  const people = seatIds.length
    ? await rows<{ personId: number; name: string; seat: string }>(
        db,
        sql`select distinct on (h.person_id) h.person_id::int as "personId", p.name, s.title as seat
          from seat s join seat_holder h on h.seat_id = s.id and ${inForce("h", today)} join person p on p.id = h.person_id
          where s.id in (${sql.join(seatIds.map((id) => sql`${id}`), sql`, `)}) and s.module = 'online' and h.person_id <> ${me.id}
          order by h.person_id, (h.kind = 'holder') desc`,
      )
    : [];
  const ids = people.map((one) => one.personId);
  const [late, figures] = await Promise.all([
    lateReplies(db, ids, today),
    ids.length
      ? rows<{ personId: number; waiting: number; today: number; lastDay: number }>(
          db,
          sql`select p.id::int as "personId",
              (select count(*) from lead l where l.assigned_to = p.id and l.desk = 'online' and l.state = 'open' and l.awaiting_reply)::int as waiting,
              (select count(*) from invoice i join sales_order o on o.id = i.order_id where (o.medrep_id = p.id or o.raised_by = p.id)
                and i.status <> 'cancelled' and i.issued_on = ${today}::date)::int as today,
              (select count(*) from invoice i join sales_order o on o.id = i.order_id where (o.medrep_id = p.id or o.raised_by = p.id)
                and i.status <> 'cancelled' and i.issued_on = ${lastDay}::date)::int as "lastDay"
            from person p where p.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`,
        )
      : Promise.resolve([]),
  ]);
  const afterHalfTwo = clock(new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Manila", hour12: false })) >= clock("14:30");
  return {
    today,
    rows: people
      .map((one) => {
        const f = figures.find((row) => row.personId === one.personId);
        const lateToday = late.get(one.personId) ?? 0;
        return {
          ...one,
          waiting: f?.waiting ?? 0,
          lateToday,
          alarm: lateToday >= LATE_ALARM,
          invoicesToday: f?.today ?? 0,
          invoicedLastDay: (f?.lastDay ?? 0) > 0,
          // No invoice by 2:30 PM: the playbook asks them to tell the coach.
          noInvoiceYet: afterHalfTwo && (f?.today ?? 0) === 0,
        };
      })
      .sort((a, b) => Number(b.alarm) - Number(a.alarm) || b.waiting - a.waiting || a.name.localeCompare(b.name)),
  };
}
