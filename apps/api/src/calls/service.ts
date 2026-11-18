// Sales calls (18 Nov 2026, the B2B team's request; Aryan: "every person adds their call logs on
// their own screen, and the data shows to everyone above them"). Whoever sells logs a call in a few
// words: the customer (from the CRM, or named as typed for one not in it yet), what came of it,
// remarks, when to call next. The call keeps the seat the caller held, so it counts in that seat's
// team and channel even after the person moves. A person sees their own calls; a team lead or head
// their team's (everyone who reports up to them); Management, the CEO and the Admin everyone's.
//
// (Replaces the Google Form the team used: the caller's name comes from their own login.)

import { peopleUnder } from "../org/scope";
import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import type { Runner } from "../inventory/service";
import type { Role } from "../people/roles";
import type { CallList, Me, SalesCallInput } from "../types";

/** Who logs calls: everyone who sells. */
export const CALLERS: readonly Role[] = ["medrep", "team_lead", "manager", "online"];
/** Who sees everyone's. */
export const WHOLE: readonly Role[] = ["ceo", "admin", "management"];
const OUTCOMES = ["reached", "no_answer", "call_back", "ordered", "not_interested", "won_back"];

const isDay = (value?: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

/** The seat a person holds today (null: none). */
export async function seatNow(tx: Runner, personId: number): Promise<number | null> {
  const today = todayManila();
  const [found] = await rows<{ id: number }>(
    tx,
    sql`select h.seat_id::int as id from seat_holder h where h.person_id = ${personId} and h.kind = 'holder'
      and h.starts_on <= ${today}::date and (h.ends_on is null or h.ends_on >= ${today}::date) order by h.starts_on desc limit 1`,
  );
  return found?.id ?? null;
}

/** The people a person sees (alias of the person id column given): themselves and everyone who
 *  reports up to them; everyone for Management, the CEO and the Admin. A lead picked by a whole
 *  viewer (or a lead under this lead) narrows it to that lead's team. */
export function visiblePeople(me: Me, column: SQL, lead?: number | null): SQL {
  // A box picked on the team switch: the people sitting in it and under it.
  if (me.unit) return sql`${column} in ${peopleUnder(me.unit)}`;
  const under = (top: number) => sql`${column} in (with recursive team as (
      select ${top}::bigint as id union all select q.id from person q join team t on q.reports_to = t.id
    ) select id from team)`;
  if (lead) return WHOLE.includes(me.role) ? under(lead) : sql`(${under(me.id)} and ${under(lead)})`;
  return WHOLE.includes(me.role) ? sql`true` : under(me.id);
}

export async function logSalesCall(db: Database, me: Me, input: SalesCallInput): Promise<{ id: number }> {
  allow(me, CALLERS, "log a call");
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Log calls from your own login.");
  if (!OUTCOMES.includes(input.outcome)) throw new Refusal(400, "invalid", "Pick what came of the call.", "outcome");
  const typed = input.customerName?.trim();
  if (!input.customerId && (!typed || typed.length < 2)) throw new Refusal(400, "invalid", "Pick the customer, or type their name.", "customer");
  if (input.nextOn && !isDay(input.nextOn)) throw new Refusal(400, "invalid", "Pick the day to call next.", "nextOn");
  if (input.nextOn && input.nextOn < todayManila()) throw new Refusal(400, "invalid", "The next call is today or later.", "nextOn");
  return db.transaction(async (tx) => {
    if (input.customerId) {
      const [found] = await rows<{ id: number }>(tx, sql`select id::int as id from customer where id = ${input.customerId}`);
      if (!found) throw new Refusal(400, "invalid", "Pick the customer from the list.", "customer");
    }
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into account_call (customer_id, customer_text, by_person, seat_id, outcome, note, next_on)
        values (${input.customerId ?? null}, ${input.customerId ? null : typed}, ${me.id}, ${await seatNow(tx, me.id)}, ${input.outcome},
          ${input.note?.trim() || null}, ${input.nextOn ?? null})
        returning id::int as id`,
    );
    if (input.customerId && input.nextOn) await tx.execute(sql`update b2b_account set next_call_on = ${input.nextOn}::date where customer_id = ${input.customerId}`);
    return { id: made?.id as number };
  });
}

/** Calls in some days, newest first, with how many each person made each day. */
export async function listCalls(db: Database, me: Me, asked: { from?: string | null; to?: string | null; person?: number | null; lead?: number | null }): Promise<CallList> {
  if (!CALLERS.includes(me.role) && !WHOLE.includes(me.role)) throw new Refusal(403, "not_allowed", "Calls are for the people who sell and those above them.");
  const to = isDay(asked.to) ? (asked.to as string) : todayManila();
  const from = isDay(asked.from) ? (asked.from as string) : to;
  if (from > to) throw new Refusal(400, "invalid", "The first day comes after the last one.", "from");
  const caller = sql`k.by_person`;
  const seen = sql`(${visiblePeople(me, caller, asked.lead)} ${asked.person ? sql`and ${caller} = ${asked.person}` : sql``})`;
  const inDays = sql`(k.at at time zone 'Asia/Manila')::date between ${from}::date and ${to}::date`;
  const [list, perDay] = await Promise.all([
    rows<CallList["rows"][number]>(
      db,
      sql`select k.id::int as id, to_char(k.at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') as at, p.name as person, ${caller}::int as "personId",
          coalesce(c.name, k.customer_text) as customer, c.id::int as "customerId", k.outcome, k.note, to_char(k.next_on, 'YYYY-MM-DD') as "nextOn"
        from account_call k left join customer c on c.id = k.customer_id left join person p on p.id = ${caller}
        where ${inDays} and ${seen} order by k.at desc limit 1000`,
    ),
    rows<{ personId: number; person: string; day: string; n: number }>(
      db,
      sql`select ${caller}::int as "personId", p.name as person, to_char(k.at at time zone 'Asia/Manila', 'YYYY-MM-DD') as day, count(*)::int as n
        from account_call k left join person p on p.id = ${caller}
        where ${inDays} and ${seen} group by 1, 2, 3 order by 2, 3`,
    ),
  ]);
  return { from, to, rows: list, perDay, can: { log: CALLERS.includes(me.role) && !me.viewedBy } };
}
