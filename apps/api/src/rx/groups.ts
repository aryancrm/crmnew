// Patient Care Groups: the Rx CHC enrols a doctor's group, MD Telesales makes first contact within
// 15 minutes (the first to contact takes the group), either logs activity, a group quiet 14 days
// goes back to the CHC to follow up. Who sees which: the CHC their own enrolments; MD Telesales
// the groups waiting for anyone and their own; the telesales coach, the Country Mentor, the CEO
// and the Admin every group.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { inForce } from "../org/service";
import type { CareGroups, Me } from "../types";

export const FIRST_CONTACT_MINUTES = 15;
const QUIET_DAYS = 14;

const isRxChc = (me: Me) => me.role === "medrep" && me.channel?.code === "RX";
const isTelesales = (me: Me) => me.role === "medrep" && me.channel?.code === "TS";
const seesAll = (me: Me) =>
  ["ceo", "admin"].includes(me.role) ||
  (["team_lead", "manager"].includes(me.role) && ["TS", "RX"].includes(me.channel?.code ?? ""));

function scope(me: Me): SQL {
  if (isRxChc(me)) return sql`g.enrolled_by = ${me.id}`;
  if (isTelesales(me)) return sql`(g.telesales_id = ${me.id} or g.telesales_id is null)`;
  if (seesAll(me)) return sql`true`;
  throw new Refusal(403, "not_allowed", "Care groups are the Rx CHCs', MD Telesales' and their heads'.");
}

export async function careGroups(db: Database, me: Me): Promise<CareGroups> {
  const where = scope(me);
  const today = todayManila();
  const list = await rows<CareGroups["rows"][number]>(
    db,
    sql`select g.id::int as id, g.name, g.doctor_id::int as "doctorId", d.name as doctor, d.phone as "doctorPhone",
        e.name as chc, t.name as telesales, g.patients, g.note,
        g.enrolled_at as "enrolledAt", g.first_contact_at as "firstContactAt", g.last_activity_at as "lastActivityAt",
        case when g.first_contact_at is null then null else round(extract(epoch from g.first_contact_at - g.enrolled_at) / 60)::int end as "contactMinutes",
        case when g.first_contact_at is null then round(extract(epoch from now() - g.enrolled_at) / 60)::int else null end as "waitingMinutes",
        floor(extract(epoch from now() - coalesce(g.last_activity_at, g.first_contact_at, g.enrolled_at)) / 86400)::int as "quietDays",
        (g.telesales_id = ${me.id}) as mine
      from care_group g join customer d on d.id = g.doctor_id join person e on e.id = g.enrolled_by
        left join person t on t.id = g.telesales_id
      where g.closed_at is null and ${where}
      order by (g.first_contact_at is null) desc, g.enrolled_at desc limit 300`,
  );
  const withState = list.map((row) => ({
    ...row,
    state: (row.waitingMinutes !== null
      ? row.waitingMinutes > FIRST_CONTACT_MINUTES
        ? "late"
        : "waiting"
      : row.quietDays >= 30
        ? "quiet30"
        : row.quietDays >= QUIET_DAYS
          ? "quiet14"
          : "active") as CareGroups["rows"][number]["state"],
  }));
  // This month: how many first contacts came within the 15 minutes.
  const [month] = await rows<{ contacted: number; inTime: number; enrolled: number; today: number }>(
    db,
    sql`select count(*) filter (where g.first_contact_at is not null)::int as contacted,
        count(*) filter (where g.first_contact_at - g.enrolled_at <= ${`${FIRST_CONTACT_MINUTES} minutes`}::interval)::int as "inTime",
        count(*)::int as enrolled,
        count(*) filter (where (g.enrolled_at at time zone 'Asia/Manila')::date = ${today}::date)::int as today
      from care_group g where date_trunc('month', g.enrolled_at at time zone 'Asia/Manila') = date_trunc('month', ${today}::date) and ${where}`,
  );
  const count = (state: string) => withState.filter((row) => row.state === state).length;
  return {
    today,
    firstContactMinutes: FIRST_CONTACT_MINUTES,
    counts: {
      waiting: count("waiting"),
      late: count("late"),
      active: count("active"),
      quiet14: count("quiet14"),
      quiet30: count("quiet30"),
      enrolledToday: month?.today ?? 0,
      enrolledThisMonth: month?.enrolled ?? 0,
      contactedInTime: month?.inTime ?? 0,
      contactedThisMonth: month?.contacted ?? 0,
    },
    rows: withState,
    can: { enrol: isRxChc(me), contact: isTelesales(me) },
  };
}

/** The Rx CHC enrols a doctor's group; the patients' consent must have been given. */
export async function enrolGroup(db: Database, me: Me, input: { doctorId: number; patients: number; consent: boolean; note?: string | null }): Promise<{ id: number }> {
  if (!isRxChc(me)) throw new Refusal(403, "not_allowed", "The Rx CHC enrols a doctor's care group.");
  if (!input.consent) throw new Refusal(400, "invalid", "Ask for the patients' consent before adding anyone to the group.", "consent");
  const [doctor] = await rows<{ name: string; kind: string }>(db, sql`select name, kind from customer where id = ${input.doctorId} and active`);
  if (doctor?.kind !== "doctor") throw new Refusal(400, "invalid", "Pick the doctor whose group this is.", "doctorId");
  const [open] = await rows<{ id: number }>(db, sql`select id::int as id from care_group where doctor_id = ${input.doctorId} and closed_at is null`);
  if (open) throw new Refusal(409, "exists", `${doctor.name} already has a care group.`, "doctorId");
  const [seat] = await rows<{ id: number }>(
    db,
    sql`select seat_id::int as id from seat_holder h where h.person_id = ${me.id} and ${inForce("h", todayManila())} order by h.starts_on desc limit 1`,
  );
  const [made] = await rows<{ id: number }>(
    db,
    sql`insert into care_group (doctor_id, name, enrolled_by, seat_id, consent, patients, note)
      values (${input.doctorId}, ${`${doctor.name} — GetMeds Prescription Care`}, ${me.id}, ${seat?.id ?? null}, true, ${input.patients},
        ${input.note?.trim() || null})
      returning id::int as id`,
  );
  return made as { id: number };
}

/** MD Telesales made first contact: the group is theirs from now on. */
export async function contactGroup(db: Database, me: Me, id: number): Promise<void> {
  if (!isTelesales(me)) throw new Refusal(403, "not_allowed", "MD Telesales make the first contact.");
  const [group] = await rows<{ telesales: string | null; contacted: boolean }>(
    db,
    sql`select t.name as telesales, g.first_contact_at is not null as contacted from care_group g
      left join person t on t.id = g.telesales_id where g.id = ${id} and g.closed_at is null`,
  );
  if (!group) throw new Refusal(404, "not_found", "No such open group.");
  if (group.contacted) throw new Refusal(409, "taken", `${group.telesales ?? "Someone"} already made first contact.`);
  await db.execute(
    sql`update care_group set telesales_id = ${me.id}, first_contact_at = now(), last_activity_at = now()
      where id = ${id} and first_contact_at is null`,
  );
}

/** The CHC or the group's telesales logs activity (and the patients in it now). */
export async function groupActivity(db: Database, me: Me, id: number, input: { patients?: number | null; note?: string | null }): Promise<void> {
  const [group] = await rows<{ enrolledBy: number; telesalesId: number | null }>(
    db,
    sql`select enrolled_by::int as "enrolledBy", telesales_id::int as "telesalesId" from care_group where id = ${id} and closed_at is null`,
  );
  if (!group) throw new Refusal(404, "not_found", "No such open group.");
  if (group.enrolledBy !== me.id && group.telesalesId !== me.id)
    throw new Refusal(403, "not_allowed", "The group's CHC or its MD Telesales logs its activity.");
  await db.execute(
    sql`update care_group set last_activity_at = now(), patients = coalesce(${input.patients ?? null}, patients),
      note = coalesce(${input.note?.trim() || null}, note) where id = ${id}`,
  );
}

/** Closes a group (the doctor left, the group stopped): kept, with the reason. */
export async function closeGroup(db: Database, me: Me, id: number, reason: string): Promise<void> {
  const [group] = await rows<{ enrolledBy: number }>(db, sql`select enrolled_by::int as "enrolledBy" from care_group where id = ${id} and closed_at is null`);
  if (!group) throw new Refusal(404, "not_found", "No such open group.");
  if (group.enrolledBy !== me.id && !seesAll(me)) throw new Refusal(403, "not_allowed", "The CHC who enrolled it or their head closes a group.");
  await db.execute(sql`update care_group set closed_at = now(), closed_by = ${me.id}, close_reason = ${reason} where id = ${id}`);
}
