// Demo only: two weeks of attendance for the demo people, so Who's working, the months and the
// CEO's card show something real (a few late, a few absent, most on time). Never runs online
// (SEED_DEMO only) and never twice.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { addDays, todayManila } from "../inventory/rules";
import { manilaMoment } from "./work-time";

export async function seedDemoAttendance(db: Database): Promise<boolean> {
  const [made] = await rows<{ n: number }>(db, sql`select count(*)::int as n from attendance`);
  if ((made?.n ?? 0) > 0) return false;
  const people = await rows<{ id: number }>(
    db,
    sql`select id::int as id from person where active and role <> 'admin' order by id`,
  );
  if (!people.length) return false;
  let seed = 20261116;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const clock = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const today = todayManila();
  const holidays = new Set(
    (
      await rows<{ day: string }>(
        db,
        sql`select to_char(day, 'YYYY-MM-DD') as day from holiday where active`,
      )
    ).map((one) => one.day),
  );
  const values = [];
  for (let back = 14; back >= 1; back -= 1) {
    const day = addDays(today, -back);
    if (new Date(`${day}T00:00:00Z`).getUTCDay() === 0 || holidays.has(day)) continue;
    for (const person of people) {
      if (random() < 0.05) continue; // absent
      const late = random() < 0.15;
      const inAt = late
        ? 7 * 60 + 5 + Math.floor(random() * 70)
        : 6 * 60 + 40 + Math.floor(random() * 20);
      const outAt = 15 * 60 + 50 + Math.floor(random() * 90);
      const ended = random() < 0.8;
      const timeIn = new Date(manilaMoment(day, clock(inAt))).toISOString();
      const timeOut = new Date(manilaMoment(day, clock(outAt))).toISOString();
      values.push(
        sql`(${person.id}, ${day}::date, ${timeIn}::timestamptz, ${random() < 0.7 ? "sign_in" : "button"},
          ${ended ? timeOut : null}::timestamptz, ${ended ? "button" : null}, ${timeOut}::timestamptz)`,
      );
    }
  }
  if (!values.length) return false;
  await db.execute(
    sql`insert into attendance (person_id, day, time_in, in_source, time_out, out_source, last_seen)
      values ${sql.join(values, sql`, `)}`,
  );
  return true;
}
