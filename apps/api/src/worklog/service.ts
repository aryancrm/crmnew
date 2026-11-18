// The work log (17 Nov): anyone may write their day in their own words, and the office staff
// (Digital Marketing, IT…) have it as their desk. Optional: an empty day is fine. One entry a day,
// changed during the day. The Founder and the Admin read everyone's; a head the people under them.

import { peopleUnder } from "../org/scope";
import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import type { Me, WorkLog, WorkLogDay } from "../types";

const entrySelect = sql`select to_char(w.day, 'YYYY-MM-DD') as day, w.done, w.today, w.tomorrow,
    to_char(w.updated_at at time zone 'Asia/Manila', 'HH24:MI') as at`;

export async function myWorkLog(db: Database, me: Me): Promise<WorkLog> {
  const today = todayManila();
  const entries = await rows<WorkLog["entries"][number]>(
    db,
    sql`${entrySelect} from work_log w where w.person_id = ${me.id} order by w.day desc limit 30`,
  );
  return { today, todayEntry: entries.find((e) => e.day === today) ?? null, entries };
}

export async function writeWorkLog(db: Database, me: Me, input: { done?: string | null; today?: string | null; tomorrow?: string | null }): Promise<void> {
  const clean = (text?: string | null) => text?.trim() || null;
  if (!clean(input.done) && !clean(input.today) && !clean(input.tomorrow)) throw new Refusal(400, "invalid", "Write at least one line.", "today");
  await db.execute(
    sql`insert into work_log (person_id, day, done, today, tomorrow) values (${me.id}, ${todayManila()}::date, ${clean(input.done)}, ${clean(input.today)}, ${clean(input.tomorrow)})
      on conflict (person_id, day) do update set done = excluded.done, today = excluded.today, tomorrow = excluded.tomorrow, updated_at = now()`,
  );
}

/** Everyone's day (the Founder, the Admin) or the people under a lead, for one day. */
export async function workLogDay(db: Database, me: Me, asked: { day?: string }): Promise<WorkLogDay> {
  const today = todayManila();
  const day = asked.day && /^\d{4}-\d{2}-\d{2}$/.test(asked.day) && asked.day <= today ? asked.day : today;
  // The Founder and the Admin read everyone's; anyone else the people under them on the tree (a
  // Mentor or Coach of any department), and nobody's when nobody reports to them.
  // A box picked on the team switch (checked when the request signed in): the people sitting in it.
  const who = me.unit
    ? sql`w.person_id in ${peopleUnder(me.unit)}`
    : ["ceo", "admin"].includes(me.role)
      ? sql`true`
      : sql`w.person_id in (with recursive team as (select id from person where reports_to = ${me.id}
        union all select p.id from person p join team t on p.reports_to = t.id) select id from team)`;
  if (!me.unit && !["ceo", "admin"].includes(me.role)) {
    const [under] = await rows<{ n: number }>(db, sql`select count(*)::int as n from person where reports_to = ${me.id} and active`);
    if (!under?.n) throw new Refusal(403, "not_allowed", "Work logs are read by the Founder and the heads.");
  }
  const entries = await rows<WorkLogDay["entries"][number]>(
    db,
    sql`${entrySelect}, p.id::int as "personId", p.name, p.title,
        (select u.name from seat_holder h join seat s on s.id = h.seat_id join org_unit u on u.id = s.unit_id
          where h.person_id = p.id and h.ends_on is null order by h.starts_on desc limit 1) as unit
      from work_log w join person p on p.id = w.person_id
      where w.day = ${day}::date and ${who}
      order by unit nulls last, p.name`,
  );
  return { day, today, entries };
}
