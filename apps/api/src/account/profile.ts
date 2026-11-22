// A person's own profile. Their name in parts makes the one name every screen reads; birth date,
// contact and emergency contact are the employee record's own fields (HR sees the same).
//
// Approvals show names, so a name can't be made to pass for someone else's: Latin letters only (no
// look-alike alphabets), never a colleague's, and HR and the Admin are told of each change.

import { sql } from "drizzle-orm";
import sharp from "sharp";
import { otherSessionCount } from "../auth/sessions";
import { type Database, rows } from "../db/index";
import { bytesOf, keepFile } from "../files/store";
import { ensureRecords } from "../hr/people";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { notify, peopleIn } from "../notify/service";
import { LOGIN_DOMAIN } from "../org/service";
import type { Me, Profile, ProfileContact, ProfilePersonal } from "../types";
import { ACCOUNT_EVENT, type AccountEventKind, accountEvent } from "./events";

export const SUFFIXES = ["Jr.", "Sr.", "II", "III", "IV", "V"] as const;
const NAME = /^\p{Script=Latin}[\p{Script=Latin} .'’-]*$/u;
const PHONE = /^\+?[0-9][0-9 -]{6,18}$/;
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const YOUNGEST = 16;
const OLDEST = 100;

/** It is theirs alone: nobody looking as them reads or changes it. */
export function ownOnly(me: Me): void {
  if (me.viewedBy) throw new Refusal(403, "private", "A profile is only for the person whose it is.");
}

/** Juan Santos Dela Cruz Jr. is shown as "Juan S. Dela Cruz Jr.". */
export function shownName(one: { first: string; middle: string | null; last: string; suffix: string | null }): string {
  return [one.first, one.middle ? `${[...one.middle][0]?.toUpperCase()}.` : null, one.last, one.suffix]
    .filter(Boolean)
    .join(" ");
}

const folded = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

export async function profileOf(db: Database, me: Me, token: string): Promise<Profile> {
  ownOnly(me);
  await ensureRecords(db);
  const today = todayManila();
  const [one] = await rows<{
    first: string | null;
    middle: string | null;
    last: string | null;
    suffix: string | null;
    birthDate: string | null;
    mobile: string | null;
    personalEmail: string | null;
    address: string | null;
    emergencyName: string | null;
    emergencyPhone: string | null;
    emergencyRelation: string | null;
    employeeCode: string | null;
    hireDate: string;
    position: string | null;
    email: string | null;
    seatLogin: string | null;
    team: string | null;
    lastSignIn: string | null;
    since: string | null;
    codesLeft: number;
  }>(
    db,
    sql`select p.first_name as first, p.middle_name as middle, p.last_name as last, p.name_suffix as suffix,
        to_char(e.birth_date, 'YYYY-MM-DD') as "birthDate", e.mobile, e.personal_email as "personalEmail", e.address,
        e.emergency_name as "emergencyName", e.emergency_phone as "emergencyPhone", e.emergency_relation as "emergencyRelation",
        e.employee_code as "employeeCode", to_char(e.hire_date, 'YYYY-MM-DD') as "hireDate", coalesce(e.position, p.title) as position,
        p.email, seat.login as "seatLogin", seat.team,
        to_char(p.last_sign_in_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "lastSignIn",
        to_char(t.on_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as since,
        coalesce(cardinality(t.recovery), 0)::int as "codesLeft"
      from person p
      join employee e on e.person_id = p.id
      left join person_two_step t on t.person_id = p.id
      left join lateral (
        select s.login, u.name as team from seat_holder h
          join seat s on s.id = h.seat_id and s.active join org_unit u on u.id = s.unit_id
        where h.person_id = p.id and h.kind = 'holder' and h.starts_on <= ${today}::date
          and (h.ends_on is null or h.ends_on >= ${today}::date)
        order by s.lead desc, h.starts_on, h.id limit 1
      ) seat on true
      where p.id = ${me.id}`,
  );
  if (!one) throw new Refusal(404, "not_found", "No such person.");
  const events = await rows<{ id: number; kind: AccountEventKind; detail: string | null; by: string | null; at: string }>(
    db,
    sql`select a.id::int as id, a.kind, a.detail,
        case when a.by_person <> a.person_id then b.name end as by,
        to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at
      from account_event a left join person b on b.id = a.by_person
      where a.person_id = ${me.id} order by a.id desc limit 15`,
  );
  // Two words are a first and a last name; more could be split several ways, so aren't guessed.
  const words = me.name.trim().split(/\s+/);
  return {
    name: me.name,
    personal: {
      firstName: one.first ?? (words.length <= 2 ? (words[0] ?? "") : ""),
      middleName: one.middle,
      lastName: one.last ?? (words.length === 2 ? (words[1] ?? "") : ""),
      suffix: one.suffix,
      birthDate: one.birthDate ?? "",
    },
    complete: Boolean(one.first && one.last && one.birthDate),
    contact: {
      mobile: one.mobile,
      personalEmail: one.personalEmail,
      address: one.address,
      emergencyName: one.emergencyName,
      emergencyPhone: one.emergencyPhone,
      emergencyRelation: one.emergencyRelation,
    },
    work: {
      loginId: one.seatLogin ? `${one.seatLogin}@${LOGIN_DOMAIN}` : one.email,
      position: one.position,
      team: one.team,
      reportsTo: me.reportsTo?.name ?? null,
      employeeCode: one.employeeCode,
      hireDate: one.hireDate,
    },
    security: {
      twoStep: { on: Boolean(one.since), since: one.since, codesLeft: one.since ? one.codesLeft : 0 },
      lastSignIn: one.lastSignIn,
      otherSessions: await otherSessionCount(db, me.id, token),
      events: events.map(({ kind, ...event }) => ({ ...event, what: ACCOUNT_EVENT[kind] ?? kind })),
    },
  };
}

function namePart(value: string | null | undefined, field: string, label: string): string | null {
  const text = (value ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
  if (!text) return null;
  if (text.length > 60) throw new Refusal(400, "invalid", `Keep the ${label} to 60 letters.`, field);
  if (!NAME.test(text))
    throw new Refusal(400, "invalid", `Use letters only in the ${label} (spaces, - ' and . are fine).`, field);
  return text;
}

function birthDay(value: string): string {
  const day = value.trim();
  if (!day) throw new Refusal(400, "invalid", "Enter your birth date.", "birthDate");
  const parsed = new Date(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day)
    throw new Refusal(400, "invalid", "That isn't a real date.", "birthDate");
  const today = todayManila();
  const age = Number(today.slice(0, 4)) - Number(day.slice(0, 4)) - (today.slice(5) < day.slice(5) ? 1 : 0);
  if (age < YOUNGEST || age > OLDEST)
    throw new Refusal(400, "invalid", "Check the year: that isn't a working age.", "birthDate");
  return day;
}

export async function savePersonal(db: Database, me: Me, input: ProfilePersonal): Promise<void> {
  ownOnly(me);
  const first = namePart(input.firstName, "firstName", "first name");
  if (!first) throw new Refusal(400, "invalid", "Enter your first name.", "firstName");
  const last = namePart(input.lastName, "lastName", "last name");
  if (!last) throw new Refusal(400, "invalid", "Enter your last name.", "lastName");
  const middle = namePart(input.middleName, "middleName", "middle name");
  const suffix = input.suffix || null;
  if (suffix && !(SUFFIXES as readonly string[]).includes(suffix))
    throw new Refusal(400, "invalid", "Pick a suffix from the list.", "suffix");
  const born = birthDay(input.birthDate);
  const name = shownName({ first, middle, last, suffix });

  await ensureRecords(db);
  await db.transaction(async (tx) => {
    // Two taking the same name at the same moment: one after the other.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('person-name'))`);
    const [was] = await rows<{ name: string; first: string | null; middle: string | null; last: string | null; suffix: string | null; born: string | null }>(
      tx,
      sql`select p.name, p.first_name as first, p.middle_name as middle, p.last_name as last, p.name_suffix as suffix,
          to_char(e.birth_date, 'YYYY-MM-DD') as born
        from person p join employee e on e.person_id = p.id where p.id = ${me.id}`,
    );
    if (!was) throw new Refusal(404, "not_found", "No such person.");
    const renamed = was.name !== name;
    if (renamed) {
      const taken = new Set([folded(name), folded(`${first}${last}${suffix ?? ""}`)]);
      const others = await rows<{ name: string; first: string | null; last: string | null; suffix: string | null }>(
        tx,
        sql`select name, first_name as first, last_name as last, name_suffix as suffix from person where id <> ${me.id} and active`,
      );
      const clash = others.some(
        (one) =>
          taken.has(folded(one.name)) ||
          (one.first && one.last && taken.has(folded(`${one.first}${one.last}${one.suffix ?? ""}`))),
      );
      if (clash)
        throw new Refusal(
          409,
          "name_taken",
          "A colleague already has that name. Add your suffix, or ask HR if you really share it.",
          "lastName",
        );
    }
    await tx.execute(
      sql`update person set name = ${name}, first_name = ${first}, middle_name = ${middle}, last_name = ${last}, name_suffix = ${suffix}
        where id = ${me.id}`,
    );
    await tx.execute(
      sql`update employee set birth_date = ${born}::date, updated_at = now(), updated_by = ${me.id},
          profile_done_at = coalesce(profile_done_at, now())
        where person_id = ${me.id}`,
    );
    if (renamed) {
      const event = await accountEvent(tx, me.id, me.id, "name", `${was.name} → ${name}`);
      await notify(tx, {
        to: (await peopleIn(tx, ["hr", "admin"])).filter((id) => id !== me.id),
        kind: "account",
        title: `${was.name} changed their name to ${name}`,
        body: "Their login and role are the same. Check it if you didn't expect it.",
        link: `/hr/people/${me.id}`,
        key: `account-${event}`,
      });
    } else if (was.born !== born || was.first !== first || was.middle !== middle || was.last !== last || was.suffix !== suffix)
      await accountEvent(tx, me.id, me.id, "details");
  });
}

export async function saveContact(db: Database, me: Me, input: ProfileContact): Promise<void> {
  ownOnly(me);
  const text = (value: string | null | undefined) => value?.trim() || null;
  const mobile = text(input.mobile);
  const personalEmail = text(input.personalEmail)?.toLowerCase() ?? null;
  const address = text(input.address);
  const emergencyName = text(input.emergencyName);
  const emergencyPhone = text(input.emergencyPhone);
  const emergencyRelation = text(input.emergencyRelation);
  if (mobile && !PHONE.test(mobile))
    throw new Refusal(400, "invalid", "Type a mobile number, like 0917 555 0101.", "mobile");
  if (personalEmail && !EMAIL.test(personalEmail))
    throw new Refusal(400, "invalid", "Type an email like name@gmail.com.", "personalEmail");
  if (emergencyPhone && !PHONE.test(emergencyPhone))
    throw new Refusal(400, "invalid", "Type a mobile number, like 0917 555 0101.", "emergencyPhone");
  if (emergencyName && !emergencyPhone)
    throw new Refusal(400, "invalid", "Add the number to call them on.", "emergencyPhone");
  if (emergencyPhone && !emergencyName)
    throw new Refusal(400, "invalid", "Add whose number it is.", "emergencyName");
  await ensureRecords(db);
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`update employee set mobile = ${mobile}, personal_email = ${personalEmail}, address = ${address},
          emergency_name = ${emergencyName}, emergency_phone = ${emergencyPhone}, emergency_relation = ${emergencyRelation},
          updated_at = now(), updated_by = ${me.id}
        where person_id = ${me.id}`,
    );
    // As HR's own change of a mobile does (hr/people.ts).
    await tx.execute(sql`update person set phone = ${mobile} where id = ${me.id}`);
    await accountEvent(tx, me.id, me.id, "contact");
  });
}

// ---- the picture

const PHOTO_SIDE = 320;
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

/** A JPEG, PNG or WebP by its first bytes: what the browser says it is isn't believed. */
function isPhoto(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, 12));
  return (
    (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) ||
    head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP")
  );
}

export async function savePhoto(db: Database, me: Me, bytes: Uint8Array): Promise<number> {
  ownOnly(me);
  const unreadable = new Refusal(400, "invalid", "Choose a JPG, PNG or WebP photo.", "photo");
  if (!isPhoto(bytes)) throw unreadable;
  let square: Buffer;
  try {
    // Drawn again from its pixels: whatever else the file carried (the place it was taken) is gone.
    square = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: PHOTO_SIDE, height: PHOTO_SIDE, fit: "cover" })
      .webp({ quality: 78 })
      .toBuffer();
  } catch {
    throw unreadable;
  }
  const kept = await keepFile("people", { name: "photo.webp", mime: "image/webp", bytes: new Uint8Array(square) });
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from person where id = ${me.id} for update`);
    await tx.execute(sql`update person_photo set archived_at = now() where person_id = ${me.id} and archived_at is null`);
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into person_photo (person_id, mime, size, data, store_key)
        values (${me.id}, ${kept.mime}, ${kept.size}, ${kept.data}, ${kept.key}) returning id::int as id`,
    );
    await accountEvent(tx, me.id, me.id, "photo");
    return made?.id as number;
  });
}

export async function removePhoto(db: Database, me: Me): Promise<void> {
  ownOnly(me);
  await db.transaction(async (tx) => {
    const gone = await rows(
      tx,
      sql`update person_photo set archived_at = now() where person_id = ${me.id} and archived_at is null returning id`,
    );
    if (gone.length) await accountEvent(tx, me.id, me.id, "photo_removed");
  });
}

/** The picture shown now, for anyone signed in; an archived one opens for nobody. */
export async function readPhoto(db: Database, personId: number, photoId: number) {
  const [photo] = await rows<{ mime: string; data: Uint8Array | null; key: string | null }>(
    db,
    sql`select mime, data, store_key as key from person_photo
      where id = ${photoId} and person_id = ${personId} and archived_at is null`,
  );
  if (!photo) throw new Refusal(404, "not_found", "No picture.");
  return { mime: photo.mime, bytes: await bytesOf(photo) };
}
