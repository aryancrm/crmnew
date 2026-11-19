// Demo attendance for the live walkthrough (Aryan, 19 Nov: "in the demo data, put some people working
// and some not, someone in Management late, someone early: a colourful CEO Home"). This week's working
// days, Monday to the walkthrough day (20 Nov), for every active person but the CEO and the Admin:
// most in before their start's grace, some late, some not in; the same person and day always come
// out the same. A day a person signed in themselves is never touched (one row a day: theirs stays),
// and no time in is put after the moment the script runs. Every demo row carries the note MARK, so
// --remove takes them all off again before going live.
//
// Dry run by default (prints what it would do); --apply writes.
//
//   TEST_PGLITE_DIR=<a local database> npx tsx scripts/demo-attendance.ts [--apply] [--remove]
//   (the live database: --live, on Aryan's word: 19 Nov "put that data, then make it live")

import { sql } from "drizzle-orm";
import { type Database, openDatabase, rows } from "../src/db/index";
import { migrate } from "../src/db/migrate";

const apply = process.argv.includes("--apply");
const remove = process.argv.includes("--remove");
const live = process.argv.includes("--live");
if (!process.env.TEST_PGLITE_DIR && !live) throw new Error("Give TEST_PGLITE_DIR (a local database), or --live on Aryan's word.");
const db: Database = openDatabase(live ? { url: process.env.DATABASE_URL } : { dir: process.env.TEST_PGLITE_DIR as string });
if (!live) await migrate(db);

const MARK = "Demo · 20 Nov walkthrough";
const DAYS = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];
const where = live ? "the live database" : (process.env.TEST_PGLITE_DIR as string);

if (remove) {
  const [found] = await rows<{ n: number }>(db, sql`select count(*)::int as n from attendance where note = ${MARK}`);
  console.log(`${apply ? "Removing" : "Would remove"} ${found?.n ?? 0} demo attendance rows from ${where}.`);
  if (apply) await db.execute(sql`delete from attendance where note = ${MARK}`);
  process.exit(0);
}

/** A number in [0, 1) from the text, always the same for the same text. */
const hash = (text: string) => {
  let h = 2166136261;
  for (const c of text) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
};
const pad = (n: number) => String(n).padStart(2, "0");
const at = (day: string, minutes: number) => new Date(`${day}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00+08:00`);

const people = await rows<{ id: number; name: string; role: string }>(
  db,
  sql`select id::int as id, name, role from person where active and role not in ('admin', 'ceo') order by id`,
);
const now = new Date();
let onTime = 0;
let late = 0;
let notIn = 0;
let theirs = 0;
for (const day of DAYS) {
  for (const person of people) {
    const roll = hash(`${person.id}:${day}`);
    // About one in eight not in, one in five late (08:20 to 09:45), the rest in 07:35 to 08:13.
    if (roll < 0.12) {
      notIn++;
      continue;
    }
    const isLate = roll > 0.8;
    const minutes = isLate ? 8 * 60 + 20 + Math.floor(hash(`${person.id}:${day}:in`) * 86) : 7 * 60 + 35 + Math.floor(hash(`${person.id}:${day}:in`) * 39);
    const timeIn = at(day, minutes);
    if (timeIn > now && day !== "2026-11-20") continue;
    const out = at(day, 17 * 60 + Math.floor(hash(`${person.id}:${day}:out`) * 70));
    const timeOut = out < now ? out : null;
    if (apply) {
      const done = await rows<{ id: number }>(
        db,
        sql`insert into attendance (person_id, day, time_in, in_source, time_out, out_source, last_seen, note)
          values (${person.id}, ${day}::date, ${timeIn.toISOString()}::timestamptz, 'sign_in', ${timeOut ? timeOut.toISOString() : null}::timestamptz,
            ${timeOut ? "button" : null}, ${(timeOut ?? timeIn).toISOString()}::timestamptz, ${MARK})
          on conflict (person_id, day) do nothing returning id::int as id`,
      );
      if (!done.length) {
        theirs++;
        continue;
      }
    }
    if (isLate) late++;
    else onTime++;
  }
}
console.log(
  `${apply ? "Put" : "Would put"} demo attendance on ${where}: ${people.length} people × ${DAYS.length} days; ${onTime} on time, ${late} late, ${notIn} not in${apply ? `; ${theirs} days kept as the person's own` : ""}.`,
);
process.exit(0);
