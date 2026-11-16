// The office boxes' demo, as the 2026 chart draws them: the Digital Marketing Coaching Department
// (Kriscel, Digital Marketing Coach; Arnel, Multimedia Artist) and the IT Division (Jade and Linus,
// two of its five Employee Happiness Coachees), straight under the Founder, with a few days of work
// log. Runs once.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { addDays, todayManila } from "../inventory/rules";
import { addPerson, projectOrg } from "../org/service";
import type { Me } from "../types";

const PEOPLE = [
  ["Digital Marketing Coaching Department", "Kriscel", "kriscel", "Digital Marketing Coach"],
  ["Digital Marketing Coaching Department", "Arnel", "arnel", "Multimedia Artist"],
  ["IT Division", "Jade", "jade", "Employee Happiness Coachee"],
  ["IT Division", "Linus", "linus", "Employee Happiness Coachee"],
] as const;

const LOGS: Record<string, [string, string, string][]> = {
  kriscel: [
    ["Posted the oncology awareness carousel; replied to 14 page messages", "Boosting the carousel; drafting next week's calendar", "Shoot plan with Arnel for the refill reminder video"],
    ["Wrote captions for 5 product posts", "Page messages; report of last week's reach", "Post the carousel"],
  ],
  jade: [
    ["Set up two new laptops for the Hospital Division", "Printer on the 2nd floor; email for new joiners", "Backup check"],
    ["Fixed the warehouse scanner", "Two new laptops", "Printer"],
  ],
};

export async function seedOfficeStaff(db: Database, password: string): Promise<boolean> {
  const [done] = await rows<{ n: number }>(db, sql`select count(*)::int as n from person where email = 'kriscel@2mg.test'`);
  if (done?.n) return false;
  const [naresh] = await rows<{ id: number; name: string }>(db, sql`select id::int as id, name from person where email = 'naresh@2mg.test'`);
  const [company] = await rows<{ id: number }>(db, sql`select id::int as id from org_unit where kind = 'company'`);
  if (!naresh || !company) return false;
  const ceo = { id: naresh.id, name: naresh.name, role: "ceo" } as Me;
  const units = new Map<string, number>();
  for (const name of new Set(PEOPLE.map(([unit]) => unit))) {
    let [unit] = await rows<{ id: number }>(db, sql`select id::int as id from org_unit where lower(name) = lower(${name}) and active`);
    if (!unit)
      [unit] = await rows<{ id: number }>(
        db,
        sql`insert into org_unit (name, kind, parent_id, sort) values (${name}, 'department', ${company.id}, 90) returning id::int as id`,
      );
    if (unit) units.set(name, unit.id);
  }
  const today = todayManila();
  for (const [unit, name, login, title] of PEOPLE) {
    const added = await addPerson(db, ceo, {
      name,
      email: `${login}@2mg.test`,
      password,
      unitId: units.get(unit) ?? null,
      title,
      module: "staff",
      lead: false,
      startsOn: "2025-06-01",
    });
    await db.execute(sql`update person set must_change_password = false where id = ${added.personId}`);
    for (const [ago, [did, now, next]] of (LOGS[login] ?? []).entries())
      await db.execute(
        sql`insert into work_log (person_id, day, done, today, tomorrow, updated_at)
          values (${added.personId}, ${addDays(today, -(ago + 1))}::date, ${did}, ${now}, ${next}, now() - make_interval(days => ${ago + 1}))`,
      );
  }
  await projectOrg(db);
  return true;
}
