// SEFMED's KOLs, Hospitals and KBLs as the CRM's own customers (docs/PLAN.md 22): a list in each tab,
// For me (the customers the person looks after) or Team (a lead's team's; everyone's for the CEO),
// searched by name, city, hospital or code; a customer's field page (details, the last five
// visits, call history, the CRM orders and what it owes); its field profile (SEFMED's KOL fields:
// category, dispensing, best days and time, the serving firm…), kept apart from the customer
// record. A customer is added through the CRM's own customer form (its rules stay); SEFMED's Delete
// is "off the field's lists", asked by an MR with why and answered by their team lead.

import { type SQL, sql } from "drizzle-orm";
import { owedOf, seen, team } from "../customers/service";
import { type Database, rows } from "../db/index";
import { FIELD_READ_ROLES, LEAD_ROLES, lookedAfterBy } from "../field/visits";
import { moneyOf } from "../finance/service";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { clean, iso, type Runner } from "../inventory/service";
import type { Me } from "../types";
import { leadOf, mayDecideFor, mustUse, mustWork, textArray, words } from "./access";
import { clientFrom, clientJson } from "./cards";
import { customerOrders, lastVisits } from "./visits";
import { notify } from "../notify/service";
import {
  CATEGORIES,
  CLIENT_KINDS,
  CLIENT_TABS,
  type ClientKind,
  type ClientList,
  type ClientPage,
  type ClientTab,
  DAYS,
  type FieldProfile,
  FIRM_TYPES,
  townKey,
} from "./words";

const kindsOf = (kind: ClientTab): SQL =>
  kind === "firm"
    ? sql`('drugstore', 'distributor')`
    : kind === "doctor"
      ? sql`('doctor')`
      : kind === "patient"
        ? sql`('patient')`
        : kind === "all"
          ? sql`('doctor', 'hospital', 'drugstore', 'distributor', 'patient')`
          : sql`('hospital')`;
const offList = sql`coalesce(f.off_list, false)`;

/** The customers in a tab: mine (those I look after) or my team's (a lead's; everyone's for the
 *  CEO, Management and the Admin). */
export async function clientList(
  db: Database,
  me: Me,
  asked: { kind?: string | null; scope?: string | null; q?: string | null },
): Promise<ClientList> {
  const access = await mustUse(db, me);
  const today = todayManila();
  // The list opens on every kind; a tab narrows it.
  const kind = (CLIENT_TABS as string[]).includes(asked.kind ?? "") ? (asked.kind as ClientTab) : "all";
  const everyone = FIELD_READ_ROLES.includes(me.role);
  const teamOk = LEAD_ROLES.includes(me.role) || everyone;
  const scope = (asked.scope === "team" && teamOk) || access === "viewer" ? "team" : "mine";
  const find = clean(asked.q)?.toLowerCase();
  // A phone number typed any way (0917 555 0100, +63 917…): its digits, four or more, without the
  // country's 63 or the leading 0 (the stored number loses them too).
  const digits = (find ?? "").replace(/[^0-9]/g, "").replace(/^(63|0)/, "");
  const match = find
    ? sql`and (lower(c.name) like ${`%${find}%`} or lower(coalesce(c.city, '')) like ${`%${find}%`}
        or lower(coalesce(c.code, '')) like ${`%${find}%`} or lower(coalesce(c.specialty, '')) like ${`%${find}%`}
        ${digits.length >= 4 ? sql`or regexp_replace(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'), '^(63|0)', '') like ${`%${digits}%`}` : sql``}
        or exists (select 1 from customer h where h.id = c.works_at and lower(h.name) like ${`%${find}%`}))`
    : sql``;
  // A MedRep's own: the field's (added, their area, their seats') and the customer list's (their
  // PAP cases, their B2B accounts), so the one list leaves nobody out.
  const mine =
    me.role === "medrep"
      ? sql`(${lookedAfterBy(sql`${me.id}`, today)} or ${seen(me)})`
      : sql`${lookedAfterBy(sql`${me.id}`, today)}`;
  const theirs = everyone ? sql`true` : seen(me);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [found, counts] = await Promise.all([
    rows<{ row: ClientList["rows"][number] }>(
      db,
      sql`${team(me)} select (${clientJson})::jsonb || jsonb_build_object(
          'lastVisit', (select to_char(max(v.day), 'YYYY-MM-DD') from visit v where v.customer_id = c.id and v.status = 'done'),
          'nextVisit', (select to_char(min(v.day), 'YYYY-MM-DD') from visit v where v.customer_id = c.id and v.status = 'planned' and v.day >= ${today}::date),
          'visitsThisMonth', (select count(*) from visit v where v.customer_id = c.id and v.status = 'done' and v.day >= ${monthStart}::date),
          'patient', c.kind = 'patient',
          'orders', (select count(*)::int from sales_order o where o.customer_id = c.id and o.status not in ('draft', 'cancelled')),
          'lastOrderAt', ${iso("(select max(o.created_at) from sales_order o where o.customer_id = c.id and o.status not in ('draft', 'cancelled'))")},
          'owed', ${owedOf(today)})
          || case when c.kind = 'patient' then jsonb_build_object('detail', 'Patient', 'assignedTo', null) else '{}'::jsonb end as row
        ${clientFrom} where c.active and c.kind in ${kindsOf(kind)} and not ${offList}
          and ${scope === "mine" ? mine : theirs} ${match}
        order by c.name limit 401`,
    ),
    rows<{ mine: number; team: number }>(
      db,
      sql`${team(me)} select count(*) filter (where ${mine})::int as mine, count(*) filter (where ${teamOk ? theirs : sql`false`})::int as team
        ${clientFrom} where c.active and c.kind in ${kindsOf(kind)} and not ${offList}`,
    ),
  ]);
  return {
    kind,
    scope,
    counts: counts[0] ?? { mine: 0, team: 0 },
    rows: found.slice(0, 400).map((one) => one.row),
    more: found.length > 400,
    can: { add: access !== "viewer" && !me.viewedBy, team: teamOk },
  };
}

/** townKey (words.ts) in SQL, on a customer's city. */
const TOWN_KEY = sql`regexp_replace(regexp_replace(regexp_replace(lower(btrim(split_part(coalesce(c.city, ''), ',', 1))), '^city of\\s+', ''), '\\s+city$', ''), '\\s+', ' ', 'g')`;

/** Customers to pick for a day's visits: those the person looks after in the picked cities. */
export async function clientsIn(
  db: Database,
  me: Me,
  asked: { kind?: string | null; cities?: string | null; q?: string | null },
): Promise<ClientList["rows"]> {
  await mustUse(db, me);
  const kind = (CLIENT_KINDS as string[]).includes(asked.kind ?? "") ? (asked.kind as ClientKind) : "doctor";
  // "Makati", "Makati City" and "City of Makati" are one town (the day's town comes from the country's list).
  const cities = [...new Set((asked.cities ?? "").split("|").map(townKey).filter(Boolean))];
  const find = clean(asked.q)?.toLowerCase();
  const today = todayManila();
  const found = await rows<{ row: ClientList["rows"][number] }>(
    db,
    sql`${team(me)} select (${clientJson})::jsonb || jsonb_build_object(
        'lastVisit', (select to_char(max(v.day), 'YYYY-MM-DD') from visit v where v.customer_id = c.id and v.status = 'done'),
        'nextVisit', (select to_char(min(v.day), 'YYYY-MM-DD') from visit v where v.customer_id = c.id and v.status = 'planned' and v.day >= ${today}::date),
        'visitsThisMonth', 0) as row
      ${clientFrom} where c.active and c.kind in ${kindsOf(kind)} and not ${offList} and ${seen(me)}
        ${cities.length ? sql`and ${TOWN_KEY} in (${sql.join(cities.map((one) => sql`${one}`), sql`, `)})` : sql``}
        ${find ? sql`and (lower(c.name) like ${`%${find}%`} or lower(coalesce(c.code, '')) like ${`%${find}%`})` : sql``}
      order by ${lookedAfterBy(sql`${me.id}`, today)} desc, c.name limit 300`,
  );
  return found.map((one) => one.row);
}

/** The cities of the customers a person may visit (to pick the day's). */
export async function fieldCities(db: Runner, me: Me): Promise<string[]> {
  const found = await rows<{ city: string }>(
    db,
    sql`${team(me)} select distinct c.city from customer c
      where c.active and c.kind in ('doctor', 'hospital', 'drugstore', 'distributor') and ${seen(me)} and c.city is not null and c.city <> ''
      order by c.city limit 500`,
  );
  return found.map((one) => one.city);
}

async function seenCustomer(db: Runner, me: Me, id: number) {
  const [found] = await rows<{ id: number; kind: string; mine: boolean }>(
    db,
    sql`${team(me)} select c.id::int as id, c.kind, ${lookedAfterBy(sql`${me.id}`, todayManila())} as mine from customer c
      where c.id = ${id} and c.kind in ('doctor', 'hospital', 'drugstore', 'distributor') and ${FIELD_READ_ROLES.includes(me.role) ? sql`true` : seen(me)}`,
  );
  if (!found) throw new Refusal(404, "not_found", "No such doctor, hospital or firm of yours.");
  return found;
}

/** A customer's field page. */
export async function clientPage(db: Database, me: Me, id: number): Promise<ClientPage> {
  const access = await mustUse(db, me);
  const known = await seenCustomer(db, me, id);
  const [found] = await rows<{ row: ClientPage["client"] }>(
    db,
    sql`select (${clientJson})::jsonb || jsonb_build_object('dispensing', f.dispensing, 'qualification', f.qualification,
        'gender', f.gender, 'hospitalType', f.hospital_type, 'hospitalClass', f.hospital_class, 'firmType', f.firm_type,
        'contactPerson', f.contact_person, 'firmId', f.firm_id, 'visitsAMonth', f.visits_a_month,
        'address', c.address, 'phone', c.phone, 'email', c.email, 'licenceNo', c.licence_no, 'pin', c.pin, 'active', c.active,
        'worksAtName', (select name from customer where id = c.works_at), 'firmName', (select name from customer where id = f.firm_id),
        'offList', coalesce(f.off_list, false),
        -- The next planned visit (the customer page's What's next, 25 Nov).
        'nextVisit', (select json_build_object('id', v.id::int, 'day', to_char(v.day, 'YYYY-MM-DD')) from visit v
          where v.customer_id = c.id and v.status = 'planned' and v.day >= ${todayManila()}::date order by v.day, v.id limit 1),
        'offAsked', case when f.off_asked_at is null then null else json_build_object('by', (select name from person where id = f.off_asked_by),
          'at', ${iso("f.off_asked_at")}, 'why', f.off_why) end) as row
      ${clientFrom} where c.id = ${id}`,
  );
  if (!found) throw new Refusal(404, "not_found", "No such customer.");
  const [history, orders, owed, calls] = await Promise.all([
    lastVisits(db, id),
    customerOrders(db, id, 10),
    moneyOf(db, [id]),
    rows<{ n: number }>(db, sql`select count(*)::int as n from visit where customer_id = ${id} and status = 'done'`),
  ]);
  const member = (access === "mr" || access === "lead") && !me.viewedBy;
  const lead = LEAD_ROLES.includes(me.role) || me.role === "admin" || me.role === "management";
  const money = owed.get(id);
  const client = found.row;
  return {
    client,
    history,
    orders,
    owed: { total: money?.owed ?? 0, overdue: money?.overdue ?? 0 },
    calls: calls[0]?.n ?? 0,
    can: {
      profile: member || (lead && !me.viewedBy),
      category: lead && !me.viewedBy,
      visit: member && client.active && !client.offList,
      order: member && client.active,
      askOff: member && known.mine && !client.offList && !client.offAsked,
      answerOff: lead && !me.viewedBy && Boolean(client.offAsked),
    },
  };
}

/** Saves a customer's field profile; the category (the visit class A–D) by a team lead (or
 *  Management, the Admin), as the field has always set it. */
export async function saveProfile(db: Database, me: Me, id: number, input: Partial<FieldProfile>): Promise<void> {
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Looking at someone's screens changes nothing.");
  await mustUse(db, me);
  if (me.role === "ceo") throw new Refusal(403, "not_allowed", "The CEO reads the field; the team edits it.");
  const known = await seenCustomer(db, me, id);
  const days = [...new Set((input.prefDays ?? []).map((one) => String(one).toLowerCase()))];
  if (days.some((one) => !(DAYS as readonly string[]).includes(one))) throw new Refusal(400, "invalid", "Pick the best days.", "prefDays");
  if (input.firmType && !FIRM_TYPES.includes(input.firmType)) throw new Refusal(400, "invalid", "Pick the firm's type.", "firmType");
  if (input.hospitalType && !["government", "private"].includes(input.hospitalType))
    throw new Refusal(400, "invalid", "Government or private?", "hospitalType");
  if (input.hospitalClass && !["general", "specialty"].includes(input.hospitalClass))
    throw new Refusal(400, "invalid", "General or specialty?", "hospitalClass");
  if (input.gender && !["male", "female", "other"].includes(input.gender)) throw new Refusal(400, "invalid", "Pick the gender.", "gender");
  const visits = input.visitsAMonth ?? null;
  if (visits !== null && (!Number.isInteger(visits) || visits < 0 || visits > 31))
    throw new Refusal(400, "invalid", "Visits a month: 0 to 31.", "visitsAMonth");
  let firmId: number | null = null;
  if (known.kind === "doctor" && input.firmId) {
    const [firm] = await rows<{ id: number }>(
      db,
      sql`select id::int as id from customer where id = ${input.firmId} and kind in ('drugstore', 'distributor') and active`,
    );
    if (!firm) throw new Refusal(400, "invalid", "Pick the firm from the list.", "firmId");
    firmId = firm.id;
  }
  const lead = LEAD_ROLES.includes(me.role) || me.role === "admin" || me.role === "management";
  if (input.category !== undefined && input.category !== null) {
    const category = String(input.category).toUpperCase();
    if (!(CATEGORIES as readonly string[]).includes(category) || category === "E")
      throw new Refusal(400, "invalid", "Pick the category A to D.", "category");
    if (!lead) throw new Refusal(403, "not_allowed", "A customer's category is set by the team lead.", "category");
    await db.execute(sql`update customer set visit_class = ${category} where id = ${id}`);
  }
  const doctor = known.kind === "doctor";
  const hospital = known.kind === "hospital";
  const firm = known.kind === "drugstore" || known.kind === "distributor";
  await db.execute(
    sql`insert into customer_field (customer_id, dispensing, qualification, gender, hospital_type, hospital_class, firm_type,
        contact_person, zone, pref_days, pref_time, firm_id, visits_a_month, changed_by, changed_at)
      values (${id}, ${doctor ? (input.dispensing ?? null) : null}, ${doctor ? words(input.qualification, 120) : null},
        ${doctor ? (input.gender ?? null) : null}, ${hospital ? (input.hospitalType ?? null) : null},
        ${hospital ? (input.hospitalClass ?? null) : null}, ${firm ? (input.firmType ?? null) : null},
        ${words(input.contactPerson, 120)}, ${words(input.zone, 80)}, ${textArray(days)}, ${words(input.prefTime, 60)},
        ${firmId}, ${visits}, ${me.id}, now())
      on conflict (customer_id) do update set dispensing = excluded.dispensing, qualification = excluded.qualification,
        gender = excluded.gender, hospital_type = excluded.hospital_type, hospital_class = excluded.hospital_class,
        firm_type = excluded.firm_type, contact_person = excluded.contact_person, zone = excluded.zone,
        pref_days = excluded.pref_days, pref_time = excluded.pref_time, firm_id = excluded.firm_id,
        visits_a_month = excluded.visits_a_month, changed_by = excluded.changed_by, changed_at = now()`,
  );
}

/** An MR asks their team lead to take a customer off the field's lists, with why. */
export async function askOffList(db: Database, me: Me, id: number, why: string): Promise<void> {
  await mustWork(db, me);
  const reason = words(why, 300);
  if (!reason) throw new Refusal(400, "invalid", "Say why it should come off the list.", "why");
  const known = await seenCustomer(db, me, id);
  if (!known.mine) throw new Refusal(403, "not_allowed", "Only a customer you look after.");
  await db.transaction(async (tx) => {
    const changed = await rows<{ id: number }>(
      tx,
      sql`insert into customer_field (customer_id, off_asked_by, off_asked_at, off_why, changed_by)
        values (${id}, ${me.id}, now(), ${reason}, ${me.id})
        on conflict (customer_id) do update set off_asked_by = excluded.off_asked_by, off_asked_at = now(), off_why = excluded.off_why
          where customer_field.off_asked_at is null and not customer_field.off_list
        returning customer_id::int as id`,
    );
    if (!changed.length) throw new Refusal(409, "invalid", "Asked already, or off the list.");
    const lead = await leadOf(tx, me.id);
    if (lead)
      await notify(tx, {
        to: [lead],
        kind: "field_off_list",
        title: "A customer to take off the field's list",
        body: reason,
        link: `/field/clients/${id}`,
        key: `field_off_list:${id}:${Date.now()}`,
      });
  });
}

/** The asking MR's team lead answers: off the list (kept, with its visits), or kept on it. */
export async function answerOffList(db: Database, me: Me, id: number, remove: boolean): Promise<void> {
  const [asked] = await rows<{ by: number }>(
    db,
    sql`select off_asked_by::int as by from customer_field where customer_id = ${id} and off_asked_at is not null`,
  );
  if (!asked) throw new Refusal(409, "invalid", "That request isn't waiting.");
  if (!(await mayDecideFor(db, me, asked.by))) throw new Refusal(403, "not_allowed", "The MR's team lead answers it.");
  await db.execute(
    sql`update customer_field set off_list = ${remove}, off_asked_by = null, off_asked_at = null, off_why = null,
        changed_by = ${me.id}, changed_at = now() where customer_id = ${id}`,
  );
}

/** Off-list requests waiting for this lead (their team's). */
export async function offRequests(db: Database, me: Me) {
  await mustUse(db, me);
  return rows<{ id: number; code: string | null; name: string; kind: string; city: string | null; why: string; by: string; byId: number; at: string }>(
    db,
    sql`${team(me)} select c.id::int as id, c.code, c.name, c.kind, c.city, f.off_why as why, p.name as by, p.id::int as "byId",
        ${iso("f.off_asked_at")} as at
      from customer_field f join customer c on c.id = f.customer_id join person p on p.id = f.off_asked_by
      where f.off_asked_at is not null and not f.off_list and p.id <> ${me.id}
        and ${FIELD_READ_ROLES.includes(me.role) ? sql`true` : sql`p.id in (select id from team)`}
      order by f.off_asked_at`,
  );
}

/** The whole visit history of a customer (SEFMED's Call history), newest first. */
export async function callHistory(db: Database, me: Me, id: number): Promise<ClientPage["history"]> {
  await mustUse(db, me);
  await seenCustomer(db, me, id);
  return rows<ClientPage["history"][number]>(
    db,
    sql`select v.id::int as id, to_char(v.day, 'YYYY-MM-DD') as day, p.name as person, v.status,
        ${iso("v.checked_in_at")} as "checkedInAt", ${iso("v.done_at")} as "doneAt",
        case when cardinality(v.objectives) > 0 then to_json(v.objectives) when v.objective is not null then json_build_array(v.objective) else '[]'::json end as objectives,
        v.objective_note as "objectiveNote", v.meeting, v.outcome, v.feedback, v.notes
      from visit v join person p on p.id = v.person_id where v.customer_id = ${id}
      order by v.day desc, v.id desc limit 200`,
  );
}
