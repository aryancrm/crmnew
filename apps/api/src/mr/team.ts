// The team lead's side of the MR App (docs/PLAN.md 22): each MR today (started where, visits done
// of planned, where they are now, orders booked, the day report), what waits for the lead (day
// reports, calls to judge, plans, plan changes, expenses), the call report (SEFMED's Call reports:
// a span of days, an MR or all, each visit's details), the attendance month (present = started
// working; leave and holidays from HR), and the app's members (the Admin adds MRs and names the
// one team lead; the lead adds and removes MRs).

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { workCalendar } from "../hr/attendance";
import { isWorkDay } from "../hr/work-time";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { iso } from "../inventory/service";
import type { Me } from "../types";
import { accessOf, isLeadNow, mustSee, mustUse } from "./access";
import { cardColumns, cardFrom, type CardSql, toCard } from "./cards";
import type { LeadQueue, MemberPage, MrMe, TeamToday, VisitCard } from "./words";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

/** How the app stands for this person (for the menu). */
export async function mrMe(db: Database, me: Me): Promise<MrMe> {
  const [access, lead] = await Promise.all([
    accessOf(db, me),
    rows<{ id: number; name: string }>(
      db,
      sql`select p.id::int as id, p.name from mr_member m join person p on p.id = m.person_id where m.role = 'lead' and m.active`,
    ),
  ]);
  return { access, lead: lead[0] ?? null };
}

async function mustLook(db: Database, me: Me) {
  const access = await mustUse(db, me);
  if (access === "mr") throw new Refusal(403, "not_allowed", "The team's pages are the team lead's.");
  return access;
}

/** Each MR on a day (today by default). */
export async function teamToday(db: Database, me: Me, asked: { day?: string | null }): Promise<TeamToday> {
  await mustLook(db, me);
  const today = todayManila();
  const day = asked.day && DAY.test(asked.day) && asked.day <= today ? asked.day : today;
  const people = await rows<TeamToday["people"][number]>(
    db,
    sql`select p.id::int as id, p.name, ${iso("d.started_at")} as started, d.work_type as "workType",
        coalesce(to_json(d.cities), '[]'::json) as cities, ${iso("d.ended_at")} as ended,
        coalesce((select e.kind = 'break' from mr_day_event e where e.day_id = d.id and e.kind in ('break', 'resume')
          order by e.at desc, e.id desc limit 1), false) and d.ended_at is null as "onBreak",
        count(v.id) filter (where not v.unplanned)::int as planned,
        count(v.id)::int as visits,
        count(v.id) filter (where v.status = 'done')::int as done,
        count(v.id) filter (where v.status = 'skipped')::int as skipped,
        count(v.id) filter (where v.status = 'missed')::int as missed,
        count(v.id) filter (where v.status = 'planned')::int as open,
        count(v.id) filter (where v.status = 'done' and v.productive = 'yes')::int as productive,
        (select count(*) from mr_order o where o.person_id = p.id and o.status = 'booked'
          and (o.made_at at time zone 'Asia/Manila')::date = ${day}::date)::int as booked,
        (select coalesce(sum(o.amount), 0) from mr_order o where o.person_id = p.id and o.status = 'booked'
          and (o.made_at at time zone 'Asia/Manila')::date = ${day}::date)::float8 as "bookedAmount",
        (select c.name from mr_visit a join mr_client c on c.id = a.client_id where a.person_id = p.id and a.day = ${day}::date
          and a.status = 'planned' and a.checked_in_at is not null order by a.checked_in_at desc limit 1) as at,
        d.report_status as report
      from mr_member m join person p on p.id = m.person_id
      left join mr_day d on d.person_id = p.id and d.day = ${day}::date
      left join mr_visit v on v.person_id = p.id and v.day = ${day}::date
      where m.active and p.id <> ${me.id}
      group by p.id, p.name, d.id
      order by d.started_at is null, p.name`,
  );
  const [waiting] = await rows<TeamToday["waiting"]>(
    db,
    sql`select
        (select count(*) from mr_day where report_status = 'sent' and person_id <> ${me.id})::int as reports,
        (select count(*) from mr_visit where status = 'done' and productive = 'pending' and person_id <> ${me.id})::int as judge,
        (select count(*) from mr_plan where status = 'sent' and person_id <> ${me.id})::int as plans,
        (select count(*) from mr_deviation where status = 'waiting' and person_id <> ${me.id})::int as deviations,
        (select count(*) from mr_expense where status = 'claimed' and person_id <> ${me.id})::int as expenses`,
  );
  const weekStart = addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
  const [clients, closed, champions, feed] = await Promise.all([
    rows<TeamToday["clients"]>(
      db,
      sql`select count(*) filter (where kind = 'doctor')::int as doctors, count(*) filter (where kind = 'hospital')::int as hospitals,
          count(*) filter (where kind = 'firm')::int as firms from mr_client where active`,
    ),
    rows<TeamToday["closed"]>(
      db,
      sql`select count(*) filter (where day = ${day}::date)::int as today, count(*) filter (where day >= ${weekStart}::date)::int as week,
          count(*)::int as month
        from mr_visit where status = 'done' and day between ${`${day.slice(0, 7)}-01`}::date and ${day}::date`,
    ),
    rows<TeamToday["champions"][number]>(
      db,
      sql`select p.id::int as id, p.name, count(*)::int as closed from mr_visit v join person p on p.id = v.person_id
        where v.status = 'done' and v.day = ${day}::date group by p.id, p.name order by closed desc, p.name limit 5`,
    ),
    rows<TeamToday["feed"][number]>(
      db,
      sql`select * from (
          select ${iso("v.checked_in_at")} as at, p.name, 'checked_in' as what, c.name as client, v.id::int as "visitId"
            from mr_visit v join person p on p.id = v.person_id join mr_client c on c.id = v.client_id
            where v.day = ${day}::date and v.checked_in_at is not null
          union all
          select ${iso("v.done_at")} as at, p.name, 'closed' as what, c.name as client, v.id::int as "visitId"
            from mr_visit v join person p on p.id = v.person_id join mr_client c on c.id = v.client_id
            where v.day = ${day}::date and v.done_at is not null) f
        order by at desc limit 40`,
    ),
  ]);
  return {
    day,
    today,
    people,
    clients: clients[0] ?? { doctors: 0, hospitals: 0, firms: 0 },
    closed: closed[0] ?? { today: 0, week: 0, month: 0 },
    champions,
    feed,
    totals: {
      people: people.length,
      started: people.filter((one) => one.started).length,
      planned: people.reduce((sum, one) => sum + one.planned, 0),
      done: people.reduce((sum, one) => sum + one.done, 0),
      missed: people.reduce((sum, one) => sum + one.missed, 0),
      bookedAmount: people.reduce((sum, one) => sum + one.bookedAmount, 0),
      reportsToSee: people.filter((one) => one.report === "sent").length,
    },
    waiting: waiting ?? { reports: 0, judge: 0, plans: 0, deviations: 0, expenses: 0 },
  };
}

/** Day reports to see and calls to judge. */
export async function leadQueue(db: Database, me: Me): Promise<LeadQueue> {
  await mustLook(db, me);
  const [reports, judge] = await Promise.all([
    rows<LeadQueue["reports"][number]>(
      db,
      sql`select d.person_id::int as "personId", p.name, to_char(d.day, 'YYYY-MM-DD') as day, ${iso("d.sent_at")} as "sentAt",
          (select count(*) from mr_visit v where v.person_id = d.person_id and v.day = d.day and v.status = 'done')::int as done,
          (select count(*) from mr_visit v where v.person_id = d.person_id and v.day = d.day and v.status = 'missed')::int as missed
        from mr_day d join person p on p.id = d.person_id where d.report_status = 'sent' and d.person_id <> ${me.id}
        order by d.sent_at desc limit 100`,
    ),
    rows<CardSql & { feedback: string | null }>(
      db,
      sql`select ${cardColumns}, v.feedback ${cardFrom} where v.status = 'done' and v.productive = 'pending' and v.person_id <> ${me.id}
        order by v.done_at desc limit 100`,
    ),
  ]);
  return { reports, judge: judge.map(({ feedback, ...card }) => ({ ...toCard(card), feedback })) };
}

export type CallReport = {
  from: string;
  to: string;
  rows: (VisitCard & {
    lastVisit: string | null;
    objectiveNote: string | null;
    feedback: string | null;
    workingWith: string[];
    followUpOn: string | null;
  })[];
  people: { id: number; name: string }[];
};

/** SEFMED's Call reports: visits over a span of days, one MR or all, a status or all. */
export async function callReport(
  db: Database,
  me: Me,
  asked: { from?: string | null; to?: string | null; person?: string | null; status?: string | null; kind?: string | null },
): Promise<CallReport> {
  const access = await mustUse(db, me);
  const today = todayManila();
  const to = asked.to && DAY.test(asked.to) ? asked.to : today;
  let from = asked.from && DAY.test(asked.from) ? asked.from : to;
  if (from > to) from = to;
  if (from < addDays(to, -92)) from = addDays(to, -92);
  const personId = access === "mr" ? me.id : Number(asked.person) || null;
  if (personId) await mustSee(db, me, personId);
  const status = ["planned", "done", "skipped", "missed"].includes(asked.status ?? "") ? asked.status : null;
  const kind = ["doctor", "hospital", "firm"].includes(asked.kind ?? "") ? asked.kind : null;
  const [found, people] = await Promise.all([
    rows<CallReport["rows"][number]>(
      db,
      sql`select ${cardColumns}, v.objective_note as "objectiveNote", v.feedback,
          coalesce((select json_agg(w.name order by w.name) from person w where w.id = any (v.working_with)), '[]'::json) as "workingWith",
          (select to_char(max(b.day), 'YYYY-MM-DD') from mr_visit b where b.client_id = v.client_id and b.status = 'done' and b.day < v.day) as "lastVisit",
          (select to_char(min(f.due_on), 'YYYY-MM-DD') from mr_follow_up f where f.visit_id = v.id) as "followUpOn"
        ${cardFrom} where v.day between ${from}::date and ${to}::date
          and ${personId ? sql`v.person_id = ${personId}` : sql`v.person_id in (select person_id from mr_member)`}
          ${status ? sql`and v.status = ${status}` : sql``} ${kind ? sql`and c.kind = ${kind}` : sql``}
        order by v.day desc, v.done_at desc nulls last, v.id desc limit 1000`,
    ),
    access === "mr"
      ? Promise.resolve([] as { id: number; name: string }[])
      : rows<{ id: number; name: string }>(
          db,
          sql`select p.id::int as id, p.name from mr_member m join person p on p.id = m.person_id where m.active order by p.name`,
        ),
  ]);
  return { from, to, rows: found, people };
}

export type AttendanceMonth = {
  month: string;
  person: { id: number; name: string };
  days: { day: string; mark: "present" | "absent" | "leave" | "weekly_off" | "holiday" | "ahead"; startedAt: string | null; workType: string | null }[];
  totals: { present: number; absent: number; leave: number; weeklyOff: number; holiday: number };
  people: { id: number; name: string }[];
};

/** SEFMED's Attendance report: each day of the month present (started working), absent, on leave
 *  (HR's approved leave), weekly off or a holiday. */
export async function attendanceMonth(
  db: Database,
  me: Me,
  asked: { month?: string | null; person?: string | null },
): Promise<AttendanceMonth> {
  const access = await mustUse(db, me);
  const today = todayManila();
  const month = asked.month && MONTH.test(asked.month) ? asked.month : today.slice(0, 7);
  const personId = access === "mr" ? me.id : Number(asked.person) || me.id;
  await mustSee(db, me, personId);
  const first = `${month}-01`;
  const last = addDays(`${addDays(first, 32).slice(0, 7)}-01`, -1);
  const [{ schedule, holidays }, worked, leave, person, people] = await Promise.all([
    workCalendar(db),
    rows<{ day: string; startedAt: string; workType: string }>(
      db,
      sql`select to_char(day, 'YYYY-MM-DD') as day, ${iso("started_at")} as "startedAt", work_type as "workType"
        from mr_day where person_id = ${personId} and day between ${first}::date and ${last}::date`,
    ),
    rows<{ from: string; to: string }>(
      db,
      sql`select to_char(from_day, 'YYYY-MM-DD') as "from", to_char(to_day, 'YYYY-MM-DD') as "to" from person_leave
        where person_id = ${personId} and status = 'approved' and from_day <= ${last}::date and to_day >= ${first}::date`,
    ),
    rows<{ id: number; name: string }>(db, sql`select id::int as id, name from person where id = ${personId}`),
    access === "mr"
      ? Promise.resolve([] as { id: number; name: string }[])
      : rows<{ id: number; name: string }>(
          db,
          sql`select p.id::int as id, p.name from mr_member m join person p on p.id = m.person_id where m.active order by p.name`,
        ),
  ]);
  const days: AttendanceMonth["days"] = [];
  for (let at = first; at <= last; at = addDays(at, 1)) {
    const work = worked.find((one) => one.day === at);
    const weekday = new Date(`${at}T00:00:00Z`).getUTCDay();
    const mark = work
      ? "present"
      : at > today
        ? "ahead"
        : leave.some((one) => one.from <= at && one.to >= at)
          ? "leave"
          : holidays.has(at)
            ? "holiday"
            : !schedule.days.includes(weekday)
              ? "weekly_off"
              : isWorkDay(at, schedule, holidays) && at === today
                ? "ahead"
                : "absent";
    days.push({ day: at, mark, startedAt: work?.startedAt ?? null, workType: work?.workType ?? null });
  }
  const count = (mark: AttendanceMonth["days"][number]["mark"]) => days.filter((one) => one.mark === mark).length;
  return {
    month,
    person: person[0] as AttendanceMonth["person"],
    days,
    totals: { present: count("present"), absent: count("absent"), leave: count("leave"), weeklyOff: count("weekly_off"), holiday: count("holiday") },
    people,
  };
}

/** The app's people. */
export async function memberPage(db: Database, me: Me): Promise<MemberPage> {
  const access = await mustUse(db, me);
  const lead = await isLeadNow(db, me);
  const [members, candidates] = await Promise.all([
    rows<MemberPage["members"][number]>(
      db,
      sql`select p.id::int as "personId", p.name, p.title, p.email, m.role, m.active, ${iso("m.added_at")} as "addedAt",
          (select count(*) from mr_client c where c.assigned_to = p.id and c.active)::int as clients
        from mr_member m join person p on p.id = m.person_id
        order by m.active desc, m.role = 'lead' desc, p.name`,
    ),
    lead || me.role === "ceo"
      ? rows<MemberPage["candidates"][number]>(
          db,
          sql`select p.id::int as id, p.name, p.title from person p
            where p.active and p.role not in ('admin') and not exists (select 1 from mr_member m where m.person_id = p.id and m.active)
            order by p.name limit 600`,
        )
      : Promise.resolve([]),
  ]);
  void access;
  return {
    members,
    candidates,
    can: { manage: lead, setLead: me.role === "admin" || me.role === "ceo" },
  };
}

/** Adds a person to the app as an MR (the lead or the Admin), or makes them the team lead (the
 *  Admin or the CEO: the one lead before steps back to MR). */
export async function addMember(db: Database, me: Me, input: { personId: number; role: "mr" | "lead" }): Promise<void> {
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Looking at someone's screens changes nothing.");
  const setter = me.role === "admin" || me.role === "ceo";
  if (input.role === "lead" ? !setter : !(setter || (await isLeadNow(db, me))))
    throw new Refusal(403, "not_allowed", input.role === "lead" ? "The Admin names the team lead." : "The team lead adds MRs.");
  const [person] = await rows<{ id: number }>(db, sql`select id::int as id from person where id = ${input.personId} and active`);
  if (!person) throw new Refusal(400, "invalid", "Pick an active person.", "personId");
  await db.transaction(async (tx) => {
    if (input.role === "lead")
      await tx.execute(sql`update mr_member set role = 'mr' where role = 'lead' and active and person_id <> ${person.id}`);
    await tx.execute(
      sql`insert into mr_member (person_id, role, added_by) values (${person.id}, ${input.role}, ${me.id})
        on conflict (person_id) do update set role = excluded.role, active = true, left_at = null, added_by = excluded.added_by,
          added_at = case when mr_member.active then mr_member.added_at else now() end`,
    );
  });
}

/** Takes someone out of the app (kept, with their work). */
export async function removeMember(db: Database, me: Me, personId: number): Promise<void> {
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Looking at someone's screens changes nothing.");
  const setter = me.role === "admin" || me.role === "ceo";
  const [member] = await rows<{ role: string }>(db, sql`select role from mr_member where person_id = ${personId} and active`);
  if (!member) throw new Refusal(404, "not_found", "Not in the app.");
  if (member.role === "lead" ? !setter : !(setter || (await isLeadNow(db, me))))
    throw new Refusal(403, "not_allowed", "The team lead takes MRs out; the Admin the team lead.");
  await db.execute(sql`update mr_member set active = false, left_at = now() where person_id = ${personId}`);
}

/** The year's holidays (HR's), for the app's Holidays tile. */
export async function holidayList(db: Database, me: Me, year: string | null | undefined) {
  await mustUse(db, me);
  const asked = year && /^\d{4}$/.test(year) ? year : todayManila().slice(0, 4);
  return rows<{ day: string; name: string; kind: string }>(
    db,
    sql`select to_char(day, 'YYYY-MM-DD') as day, name, kind from holiday
      where active and day between ${`${asked}-01-01`}::date and ${`${asked}-12-31`}::date order by day`,
  );
}

export type MapPeople = {
  day: string;
  people: { id: number; name: string; points: { at: string; what: string; place: string; client: string | null }[] }[];
};

/** Where each MR's phone was today at the moments the app took it: start, a change of place, a
 *  break, I'm here, a call closed, stop. No trail in between. */
export async function mapToday(db: Database, me: Me, person: number | null): Promise<MapPeople> {
  const access = await mustUse(db, me);
  const today = todayManila();
  const personId = access === "mr" ? me.id : person;
  if (personId) await mustSee(db, me, personId);
  const people = await rows<{ id: number; name: string }>(
    db,
    sql`select p.id::int as id, p.name from mr_member m join person p on p.id = m.person_id
      where m.active ${personId ? sql`and p.id = ${personId}` : sql``} order by p.name`,
  );
  const points = await rows<{ personId: number; at: string; what: string; place: string; client: string | null }>(
    db,
    sql`select * from (
        select d.person_id::int as "personId", ${iso("e.at")} as at,
          case e.kind when 'start' then 'Started working' when 'place' then 'Changed place' when 'break' then 'Break'
            when 'resume' then 'Back to work' else 'Stopped working' end as what, e.place, null::text as client
        from mr_day_event e join mr_day d on d.id = e.day_id where d.day = ${today}::date and e.place is not null
        union all
        select v.person_id::int, ${iso("v.checked_in_at")}, 'I''m here', v.check_in_place, c.name
        from mr_visit v join mr_client c on c.id = v.client_id where v.day = ${today}::date and v.check_in_place is not null
        union all
        select v.person_id::int, ${iso("v.done_at")}, 'Closed the call', v.closed_place, c.name
        from mr_visit v join mr_client c on c.id = v.client_id where v.day = ${today}::date and v.closed_place is not null) p
      order by at`,
  );
  return {
    day: today,
    people: people.map((one) => ({ ...one, points: points.filter((point) => point.personId === one.id).map(({ personId: _p, ...point }) => point) })),
  };
}
