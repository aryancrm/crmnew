// Holidays by town (docs/HR-PLAN.md step 4). A holiday is national (table `holiday`: the company's
// calendar, what desks' clocks stop on) or local to a province or one city or municipality
// (`local_holiday`, the 2026 proclamations seeded by migration 0155). A person's own holidays are
// the national ones plus those of their province and their town: attendance (working day, late,
// absent), leave days, the overtime form's kind of day and payroll's holiday pay read them.
//
// Whose town: the person's work town on their HR record (`employee.work_town`, picked from the
// CRM's town list), else the first city of their seat's area (their own area when they hold no
// seat), read against the town list; nobody's local holidays apply when neither gives a town.
// HR and the Admin add a holiday and archive one (never deleted); HR, the CEO and the Admin read.

import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { clean, iso, type Runner } from "../inventory/service";
import type { HolidayInput, HolidayRow, HolidayYear, Me } from "../types";
import { HR_ROLES, HR_WRITE_ROLES } from "./people";

// ------------------------------------------------------------------ the town list

type Town = [name: string, province: string, city: 0 | 1];
/** The CRM's cities and municipalities with their province (PSGC). The same file as the web's
 *  apps/web/public/places/ph-towns.json (a test keeps them equal). */
let towns: Town[] | null = null;
export function townList(): Town[] {
  towns ??= (
    JSON.parse(readFileSync(new URL("../places/ph-towns.json", import.meta.url), "utf8")) as {
      towns: Town[];
    }
  ).towns;
  return towns;
}

const plain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
/** A town as people write it, made one: "City of Makati", "Makati City" → "makati". */
const townWords = (name: string) =>
  plain(name)
    .replace(/^city of\s+/, "")
    .replace(/\s+city$/, "");

export type Place = { province: string; town: string | null };

/** A town and province exactly as the list has them (any case), or null. */
export function townOnList(town: string, province: string): Place | null {
  const found = townList().find(
    (one) => plain(one[0]) === plain(town) && plain(one[1]) === plain(province),
  );
  return found ? { town: found[0], province: found[1] } : null;
}

/** A province on the list (any case), as the list writes it. */
export function provinceOnList(province: string): string | null {
  return townList().find((one) => plain(one[1]) === plain(province))?.[1] ?? null;
}

/** A city as an area lists it ("Pasay", "Pasay City", "San Jose, Batangas"): the one town of that
 *  name on the list (in that province when it says), else null when none or several fit. */
export function townFromName(name: string): Place | null {
  const [head, province] = name.split(",").map((one) => one.trim());
  if (!head) return null;
  const fits = townList().filter(
    (one) =>
      townWords(one[0]) === townWords(head) && (!province || plain(one[1]) === plain(province)),
  );
  // A city and a town of one name (San Fernando): the city.
  const cities = fits.filter((one) => one[2] === 1);
  const pick = fits.length === 1 ? fits[0] : cities.length === 1 ? cities[0] : undefined;
  return pick ? { town: pick[0], province: pick[1] } : null;
}

/** Whether a local holiday is the place's: its province, and its town unless it is province-wide. */
export function localApplies(
  holiday: { province: string; town: string | null },
  place: Place | null,
): boolean {
  if (!place || plain(holiday.province) !== plain(place.province)) return false;
  return holiday.town === null || (place.town !== null && plain(holiday.town) === plain(place.town));
}

// ------------------------------------------------------------------ each person's holidays

export type DayHoliday = { name: string; kind: "regular" | "special"; local: boolean };
export type PersonPlace = Place & { from: "record" | "area" };

const idList = (ids: number[]) =>
  sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );

/** Where each person's local holidays follow: their work town, else their seat area's first city. */
export async function placesOf(
  db: Runner,
  ids: number[],
): Promise<Map<number, PersonPlace | null>> {
  const out = new Map<number, PersonPlace | null>();
  if (!ids.length) return out;
  const found = await rows<{
    id: number;
    town: string | null;
    province: string | null;
    cities: string[] | null;
  }>(
    db,
    sql`select p.id::int as id, e.work_town as town, e.work_province as province,
        coalesce(
          (select a.cities from seat_holder h join seat s on s.id = h.seat_id and s.active
             join area a on a.id = s.area_id
           where h.person_id = p.id and h.kind = 'holder' and h.starts_on <= (now() at time zone 'Asia/Manila')::date
             and (h.ends_on is null or h.ends_on >= (now() at time zone 'Asia/Manila')::date)
           order by h.starts_on, h.id limit 1),
          (select a.cities from area a where a.id = p.area_id)) as cities
      from person p left join employee e on e.person_id = p.id where p.id in (${idList(ids)})`,
  );
  for (const one of found) {
    if (one.town && one.province) {
      out.set(one.id, { town: one.town, province: one.province, from: "record" });
      continue;
    }
    const first = (typeof one.cities === "string" ? parseArray(one.cities) : one.cities)?.[0];
    const place = first ? townFromName(first) : null;
    out.set(one.id, place ? { ...place, from: "area" } : null);
  }
  return out;
}

/** A text[] that came back as Postgres text ("{a,b}"). */
const parseArray = (text: string) =>
  text
    .replace(/^\{|\}$/g, "")
    .split(",")
    .map((one) => one.replace(/^"|"$/g, "").trim())
    .filter(Boolean);

/** The national holidays between two days (the company's calendar), with their kind. */
export async function nationalHolidays(
  db: Runner,
  from: string,
  to: string,
): Promise<Map<string, DayHoliday>> {
  const found = await rows<{ day: string; name: string; kind: "regular" | "special" }>(
    db,
    sql`select to_char(day, 'YYYY-MM-DD') as day, name, kind from holiday
      where active and day between ${from}::date and ${to}::date`,
  );
  return new Map(found.map((one) => [one.day, { name: one.name, kind: one.kind, local: false }]));
}

/** Each person's holidays between two days: the national ones and their town's and province's. */
export async function holidaysOf(
  db: Runner,
  ids: number[],
  from: string,
  to: string,
): Promise<Map<number, Map<string, DayHoliday>>> {
  const out = new Map<number, Map<string, DayHoliday>>();
  if (!ids.length) return out;
  const national = await nationalHolidays(db, from, to);
  const local = await rows<{
    day: string;
    name: string;
    kind: "regular" | "special";
    province: string;
    town: string | null;
  }>(
    db,
    sql`select to_char(day, 'YYYY-MM-DD') as day, name, kind, province, town from local_holiday
      where active and day between ${from}::date and ${to}::date order by day, town nulls first`,
  );
  const places = local.length ? await placesOf(db, ids) : new Map<number, PersonPlace | null>();
  for (const id of ids) {
    const mine = new Map(national);
    const place = places.get(id) ?? null;
    for (const one of local)
      if (!mine.has(one.day) && localApplies(one, place))
        mine.set(one.day, { name: one.name, kind: one.kind, local: true });
    out.set(id, mine);
  }
  return out;
}

/** One person's holidays, by day: their names (what attendance shows). */
export async function holidayNamesOf(
  db: Runner,
  personId: number,
  from: string,
  to: string,
): Promise<Map<string, string>> {
  const mine = (await holidaysOf(db, [personId], from, to)).get(personId) ?? new Map();
  return new Map([...mine].map(([day, one]) => [day, one.name]));
}

// ------------------------------------------------------------------ HR's Holidays page

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The year's holidays: national, and local ones (all, a province's, or those of one town). */
export async function holidayYear(
  db: Database,
  me: Me,
  asked: { year?: string | null; province?: string | null; town?: string | null },
): Promise<HolidayYear> {
  allow(me, HR_ROLES, "read the holidays");
  const thisYear = Number(new Date().toISOString().slice(0, 4));
  const year =
    asked.year && /^\d{4}$/.test(asked.year) && Number(asked.year) >= 2000 && Number(asked.year) <= 2100
      ? Number(asked.year)
      : thisYear;
  const province = asked.province?.trim() ? provinceOnList(asked.province) : null;
  const town = province && asked.town?.trim() ? townOnList(asked.town, province)?.town ?? null : null;
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const national = await rows<Omit<HolidayRow, "scope" | "province" | "town" | "archived"> & {
    archivedBy: string | null;
    archivedAt: string | null;
    note: string | null;
  }>(
    db,
    sql`select h.id::int as id, to_char(h.day, 'YYYY-MM-DD') as day, h.name, h.kind, h.proclamation,
        m.name as "madeBy", a.name as "archivedBy", ${iso("h.archived_at")} as "archivedAt", h.archive_note as note
      from holiday h left join person m on m.id = h.made_by left join person a on a.id = h.archived_by
      where h.day between ${from}::date and ${to}::date and (h.active or h.archived_at is not null)
      order by h.day`,
  );
  const local = await rows<Omit<HolidayRow, "scope" | "archived"> & {
    archivedBy: string | null;
    archivedAt: string | null;
    note: string | null;
  }>(
    db,
    sql`select h.id::int as id, to_char(h.day, 'YYYY-MM-DD') as day, h.name, h.kind, h.province, h.town,
        h.proclamation, m.name as "madeBy", a.name as "archivedBy", ${iso("h.archived_at")} as "archivedAt",
        h.archive_note as note
      from local_holiday h left join person m on m.id = h.made_by left join person a on a.id = h.archived_by
      where h.day between ${from}::date and ${to}::date
        ${province ? sql`and lower(h.province) = ${province.toLowerCase()}` : sql``}
      order by h.day, h.province, h.town nulls first`,
  );
  const archived = (one: { archivedBy: string | null; archivedAt: string | null; note: string | null }) =>
    one.archivedAt ? { by: one.archivedBy, at: one.archivedAt, note: one.note } : null;
  const holidays: HolidayRow[] = [
    ...national.map(({ archivedBy, archivedAt, note, ...one }) => ({
      ...one,
      scope: "national" as const,
      province: null,
      town: null,
      archived: archived({ archivedBy, archivedAt, note }),
    })),
    ...local
      .filter(
        (one) =>
          !town ||
          localApplies({ province: one.province ?? "", town: one.town }, {
            province: province as string,
            town,
          }),
      )
      .map(({ archivedBy, archivedAt, note, ...one }) => ({
        ...one,
        scope: "local" as const,
        archived: archived({ archivedBy, archivedAt, note }),
      })),
  ].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.scope === "national" ? -1 : 1));
  return {
    year,
    province,
    town,
    holidays,
    can: { change: HR_WRITE_ROLES.includes(me.role) && !me.viewedBy },
  };
}

/** HR adds a holiday: national (no province), a whole province's, or one town's. */
export async function addHoliday(db: Database, me: Me, input: HolidayInput): Promise<{ id: number }> {
  allow(me, HR_WRITE_ROLES, "add holidays");
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
  if (!DAY.test(input.day ?? "")) throw new Refusal(400, "invalid", "Pick the day.", "day");
  const name = clean(input.name);
  if (!name) throw new Refusal(400, "invalid", "Name the holiday.", "name");
  if (name.length > 160) throw new Refusal(400, "invalid", "Keep the name short.", "name");
  if (input.kind !== "regular" && input.kind !== "special")
    throw new Refusal(400, "invalid", "Pick a regular holiday or a special day.", "kind");
  const provinceTyped = clean(input.province);
  const townTyped = clean(input.town);
  if (!provinceTyped && townTyped)
    throw new Refusal(400, "invalid", "Pick the town's province.", "province");
  return db.transaction(async (tx) => {
    const [national] = await rows<{ name: string }>(
      tx,
      sql`select name from holiday where active and day = ${input.day}::date`,
    );
    if (national)
      throw new Refusal(409, "taken", `${input.day} is a national holiday already (${national.name}).`, "day");
    if (!provinceTyped) {
      const [made] = await rows<{ id: number }>(
        tx,
        sql`insert into holiday (day, name, kind, made_by, made_at)
          values (${input.day}::date, ${name}, ${input.kind}, ${me.id}, now()) returning id::int as id`,
      );
      return { id: made?.id as number };
    }
    const province = provinceOnList(provinceTyped);
    if (!province) throw new Refusal(400, "invalid", "Pick a province from the list.", "province");
    const town = townTyped ? townOnList(townTyped, province)?.town : null;
    if (townTyped && !town)
      throw new Refusal(400, "invalid", `Pick a town of ${province} from the list.`, "town");
    const [taken] = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from local_holiday where active and day = ${input.day}::date
        and lower(province) = ${province.toLowerCase()} and lower(coalesce(town, '')) = ${(town ?? "").toLowerCase()}`,
    );
    if (taken)
      throw new Refusal(409, "taken", `${town ?? province} has a holiday on ${input.day} already.`, "day");
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into local_holiday (day, name, kind, province, town, made_by)
        values (${input.day}::date, ${name}, ${input.kind}, ${province}, ${town ?? null}, ${me.id})
        returning id::int as id`,
    );
    return { id: made?.id as number };
  });
}

/** HR archives a holiday (a mistake, a moved day): it stops counting, and is kept. */
export async function archiveHoliday(
  db: Database,
  me: Me,
  scope: "national" | "local",
  id: number,
  note: string | null | undefined,
): Promise<void> {
  allow(me, HR_WRITE_ROLES, "archive holidays");
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
  const table = sql.raw(scope === "national" ? "holiday" : "local_holiday");
  const [done] = await rows<{ id: number }>(
    db,
    sql`update ${table} set active = false, archived_by = ${me.id}, archived_at = now(),
        archive_note = ${clean(note) ?? null}
      where id = ${id} and active returning id::int as id`,
  );
  if (!done) throw new Refusal(404, "not_found", "No such holiday in force.");
}
