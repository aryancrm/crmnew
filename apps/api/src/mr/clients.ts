// The MR App's doctors (KOLs), hospitals and firms (KBLs), each once (SEFMED's masters): a list
// in each tab, For me (assigned to me) or Team (everyone's), searched by name, city, hospital or
// code; a client's page (details, the last five visits, call history, orders booked); add and
// edit (an MR their own; the team lead any, and assigns them); Delete in SEFMED is "inactive"
// here, by the team lead: nothing with history is deleted.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { clean, iso, type Runner } from "../inventory/service";
import type { Me } from "../types";
import { accessOf, isLeadNow, mustUse, mustWork, textArray, words } from "./access";
import { clientJson } from "./cards";
import { orderRows } from "./orders";
import { lastVisits } from "./visits";
import {
  CATEGORIES,
  CLIENT_KINDS,
  type ClientInput,
  type ClientKind,
  type ClientList,
  type ClientPage,
  DAYS,
  FIRM_TYPES,
} from "./words";

const CODE_PREFIX: Record<ClientKind, string> = { doctor: "D", hospital: "H", firm: "F" };

/** The clients in a tab: mine (assigned to me) or the team's (every active client). */
export async function clientList(
  db: Database,
  me: Me,
  asked: { kind?: string | null; scope?: string | null; q?: string | null; person?: string | null },
): Promise<ClientList> {
  const access = await mustUse(db, me);
  const today = todayManila();
  const kind = (CLIENT_KINDS as string[]).includes(asked.kind ?? "") ? (asked.kind as ClientKind) : "doctor";
  const mineOf = access === "viewer" ? null : me.id;
  const scope = asked.scope === "mine" && mineOf ? "mine" : asked.scope === "team" || !mineOf ? "team" : "mine";
  const picked = Number(asked.person) || null;
  const find = clean(asked.q)?.toLowerCase();
  const match = find
    ? sql`and (lower(c.name) like ${`%${find}%`} or lower(coalesce(c.city, '')) like ${`%${find}%`}
        or lower(c.code) like ${`%${find}%`} or lower(coalesce(c.specialty, '')) like ${`%${find}%`}
        or exists (select 1 from mr_client h where h.id = c.works_at and lower(h.name) like ${`%${find}%`}))`
    : sql``;
  const whose: SQL =
    scope === "mine" ? sql`c.assigned_to = ${mineOf}` : picked ? sql`c.assigned_to = ${picked}` : sql`true`;
  const monthStart = `${today.slice(0, 7)}-01`;
  const [found, counts, members, lead] = await Promise.all([
    rows<ClientList["rows"][number]>(
      db,
      sql`select (${clientJson})::jsonb || jsonb_build_object(
          'lastVisit', (select to_char(max(v.day), 'YYYY-MM-DD') from mr_visit v where v.client_id = c.id and v.status = 'done'),
          'nextVisit', (select to_char(min(v.day), 'YYYY-MM-DD') from mr_visit v where v.client_id = c.id and v.status = 'planned' and v.day >= ${today}::date),
          'visitsThisMonth', (select count(*) from mr_visit v where v.client_id = c.id and v.status = 'done' and v.day >= ${monthStart}::date)) as row
        from mr_client c where c.active and c.kind = ${kind} and ${whose} ${match}
        order by c.name limit 401`,
    ).then((list) => list.map((one) => (one as unknown as { row: ClientList["rows"][number] }).row)),
    rows<{ mine: number; team: number }>(
      db,
      sql`select count(*) filter (where c.assigned_to = ${mineOf ?? 0})::int as mine, count(*)::int as team
        from mr_client c where c.active and c.kind = ${kind}`,
    ),
    rows<{ id: number; name: string }>(
      db,
      sql`select p.id::int as id, p.name from mr_member m join person p on p.id = m.person_id where m.active order by p.name`,
    ),
    isLeadNow(db, me),
  ]);
  return {
    kind,
    scope,
    counts: counts[0] ?? { mine: 0, team: 0 },
    rows: found.slice(0, 400),
    more: found.length > 400,
    members,
    can: { add: access === "mr" || access === "lead" || lead, assign: lead },
  };
}

function checkInput(input: ClientInput): Record<string, unknown> {
  if (!CLIENT_KINDS.includes(input.kind)) throw new Refusal(400, "invalid", "Pick doctor, hospital or firm.", "kind");
  const name = words(input.name, 160);
  if (!name) throw new Refusal(400, "invalid", "Type the name.", "name");
  const category = input.category ? String(input.category).toUpperCase() : null;
  if (category && !(CATEGORIES as readonly string[]).includes(category))
    throw new Refusal(400, "invalid", "Pick the category A to E.", "category");
  if (input.firmType && !FIRM_TYPES.includes(input.firmType)) throw new Refusal(400, "invalid", "Pick the firm's type.", "firmType");
  if (input.kind === "firm" && !input.firmType) throw new Refusal(400, "invalid", "Pick the firm's type.", "firmType");
  if (input.hospitalType && !["government", "private"].includes(input.hospitalType))
    throw new Refusal(400, "invalid", "Government or private?", "hospitalType");
  if (input.hospitalClass && !["general", "specialty"].includes(input.hospitalClass))
    throw new Refusal(400, "invalid", "General or specialty?", "hospitalClass");
  if (input.gender && !["male", "female", "other"].includes(input.gender)) throw new Refusal(400, "invalid", "Pick the gender.", "gender");
  const days = [...new Set((input.prefDays ?? []).map((one) => String(one).toLowerCase()))];
  if (days.some((one) => !(DAYS as readonly string[]).includes(one))) throw new Refusal(400, "invalid", "Pick the best days.", "prefDays");
  const visits = input.visitsAMonth ?? null;
  if (visits !== null && (!Number.isInteger(visits) || visits < 0 || visits > 31))
    throw new Refusal(400, "invalid", "Visits a month: 0 to 31.", "visitsAMonth");
  const city = words(input.city, 80);
  if (!city) throw new Refusal(400, "invalid", "Type the city.", "city");
  return {
    name,
    specialty: input.kind === "doctor" ? words(input.specialty, 120) : null,
    category: input.kind === "doctor" ? category : null,
    dispensing: input.kind === "doctor" ? (input.dispensing ?? null) : null,
    qualification: input.kind === "doctor" ? words(input.qualification, 120) : null,
    registrationNo: input.kind === "doctor" ? words(input.registrationNo, 60) : null,
    gender: input.kind === "doctor" ? (input.gender ?? null) : null,
    hospitalType: input.kind === "hospital" ? (input.hospitalType ?? null) : null,
    hospitalClass: input.kind === "hospital" ? (input.hospitalClass ?? null) : null,
    firmType: input.kind === "firm" ? (input.firmType ?? null) : null,
    contactPerson: words(input.contactPerson, 120),
    phone: words(input.phone, 40),
    email: words(input.email, 120),
    address: words(input.address, 300),
    city,
    zone: words(input.zone, 80),
    prefDays: days,
    prefTime: words(input.prefTime, 60),
    visitsAMonth: visits,
    note: words(input.note, 500),
  };
}

async function linkOk(db: Runner, id: number | null | undefined, kind: ClientKind, field: string): Promise<number | null> {
  if (!id) return null;
  const [found] = await rows<{ id: number }>(db, sql`select id::int as id from mr_client where id = ${id} and kind = ${kind} and active`);
  if (!found) throw new Refusal(400, "invalid", `Pick the ${kind} from the list.`, field);
  return found.id;
}

async function assigneeOk(db: Runner, id: number | null | undefined): Promise<number | null> {
  if (!id) return null;
  const [found] = await rows<{ id: number }>(db, sql`select person_id::int as id from mr_member where person_id = ${id} and active`);
  if (!found) throw new Refusal(400, "invalid", "Assign it to someone in the app.", "assignedTo");
  return found.id;
}

/** Adds a client: an MR's goes to themselves; the team lead assigns it to anyone in the app. */
export async function addClient(db: Database, me: Me, input: ClientInput): Promise<{ id: number; code: string }> {
  const lead = await isLeadNow(db, me);
  if (!lead) await mustWork(db, me);
  const values = checkInput(input);
  const worksAt = input.kind === "doctor" ? await linkOk(db, input.worksAt, "hospital", "worksAt") : null;
  const firmId = input.kind === "doctor" ? await linkOk(db, input.firmId, "firm", "firmId") : null;
  const assignedTo = lead ? await assigneeOk(db, input.assignedTo ?? me.id).catch(() => null) : me.id;
  return db.transaction(async (tx) => {
    const [same] = await rows<{ code: string }>(
      tx,
      sql`select code from mr_client where active and kind = ${input.kind} and lower(name) = lower(${values.name as string})
        and lower(coalesce(city, '')) = lower(${values.city as string})`,
    );
    if (same) throw new Refusal(409, "taken", `Already in the list as ${same.code}.`, "name");
    const [counter] = await rows<{ value: number }>(
      tx,
      sql`update counter set value = value + 1 where name = ${`mr_${input.kind}`} returning value::int as value`,
    );
    const code = `${CODE_PREFIX[input.kind]}${String(counter?.value ?? 1).padStart(4, "0")}`;
    const v = values as Record<string, string | number | boolean | string[] | null>;
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into mr_client (kind, code, name, specialty, category, dispensing, qualification, registration_no, gender,
          hospital_type, hospital_class, firm_type, contact_person, phone, email, address, city, zone, pref_days, pref_time,
          works_at, firm_id, assigned_to, visits_a_month, note, added_by)
        values (${input.kind}, ${code}, ${v.name}, ${v.specialty}, ${v.category}, ${v.dispensing}, ${v.qualification},
          ${v.registrationNo}, ${v.gender}, ${v.hospitalType}, ${v.hospitalClass}, ${v.firmType}, ${v.contactPerson}, ${v.phone},
          ${v.email}, ${v.address}, ${v.city}, ${v.zone}, ${textArray(v.prefDays as string[])}, ${v.prefTime}, ${worksAt},
          ${firmId}, ${assignedTo}, ${v.visitsAMonth}, ${v.note}, ${me.id})
        returning id::int as id`,
    );
    return { id: made?.id as number, code };
  });
}

/** Changes a client: an MR their own (assigned to them or added by them); the lead any, and
 *  reassigns it. */
export async function editClient(db: Database, me: Me, id: number, input: ClientInput): Promise<void> {
  const lead = await isLeadNow(db, me);
  if (!lead) await mustWork(db, me);
  const [client] = await rows<{ kind: ClientKind; assignedTo: number | null; addedBy: number }>(
    db,
    sql`select kind, assigned_to::int as "assignedTo", added_by::int as "addedBy" from mr_client where id = ${id} and active`,
  );
  if (!client) throw new Refusal(404, "not_found", "No such client.");
  if (!lead && client.assignedTo !== me.id && client.addedBy !== me.id)
    throw new Refusal(403, "not_allowed", "Only your own clients are changed by you; ask your team lead.");
  const values = checkInput({ ...input, kind: client.kind }) as Record<string, string | number | boolean | string[] | null>;
  const worksAt = client.kind === "doctor" ? await linkOk(db, input.worksAt, "hospital", "worksAt") : null;
  const firmId = client.kind === "doctor" ? await linkOk(db, input.firmId, "firm", "firmId") : null;
  const assignedTo = lead ? await assigneeOk(db, input.assignedTo) : client.assignedTo;
  if (worksAt === id || firmId === id) throw new Refusal(400, "invalid", "A client can't be its own hospital or firm.", "worksAt");
  await db.execute(
    sql`update mr_client set name = ${values.name}, specialty = ${values.specialty}, category = ${values.category},
        dispensing = ${values.dispensing}, qualification = ${values.qualification}, registration_no = ${values.registrationNo},
        gender = ${values.gender}, hospital_type = ${values.hospitalType}, hospital_class = ${values.hospitalClass},
        firm_type = ${values.firmType}, contact_person = ${values.contactPerson}, phone = ${values.phone}, email = ${values.email},
        address = ${values.address}, city = ${values.city}, zone = ${values.zone}, pref_days = ${textArray(values.prefDays as string[])},
        pref_time = ${values.prefTime}, works_at = ${worksAt}, firm_id = ${firmId}, assigned_to = ${assignedTo},
        visits_a_month = ${values.visitsAMonth}, note = ${values.note}
      where id = ${id}`,
  );
}

/** The team lead takes a client off the lists (SEFMED's Delete): kept, with its history. */
export async function deactivateClient(db: Database, me: Me, id: number): Promise<void> {
  if (!(await isLeadNow(db, me))) throw new Refusal(403, "not_allowed", "Only the team lead takes a client off the list.");
  const changed = await rows<{ id: number }>(
    db,
    sql`update mr_client set active = false where id = ${id} and active returning id::int as id`,
  );
  if (!changed.length) throw new Refusal(404, "not_found", "No such client.");
}

/** An MR asks the team lead to take a client off the list (SEFMED's Delete request), with why. */
export async function askDelete(db: Database, me: Me, id: number, why: string): Promise<void> {
  await mustWork(db, me);
  const reason = words(why, 300);
  if (!reason) throw new Refusal(400, "invalid", "Say why it should come off the list.", "why");
  const changed = await rows<{ id: number }>(
    db,
    sql`update mr_client set delete_asked_by = ${me.id}, delete_asked_at = now(), delete_why = ${reason}
      where id = ${id} and active and delete_asked_at is null returning id::int as id`,
  );
  if (!changed.length) throw new Refusal(409, "invalid", "Asked already, or not on the list.");
}

/** The team lead answers a delete request: off the list, or kept (the request is cleared). */
export async function answerDelete(db: Database, me: Me, id: number, remove: boolean): Promise<void> {
  if (!(await isLeadNow(db, me))) throw new Refusal(403, "not_allowed", "Only the team lead answers a delete request.");
  const changed = await rows<{ id: number }>(
    db,
    sql`update mr_client set active = ${!remove}, delete_asked_by = null, delete_asked_at = null, delete_why = null
      where id = ${id} and active and delete_asked_at is not null returning id::int as id`,
  );
  if (!changed.length) throw new Refusal(409, "invalid", "That request isn't waiting.");
}

/** Delete requests waiting for the team lead. */
export async function deleteRequests(db: Database, me: Me) {
  if (!(await isLeadNow(db, me)) && me.role !== "ceo") throw new Refusal(403, "not_allowed", "Delete requests are the team lead's.");
  return rows<{ id: number; code: string; name: string; kind: string; city: string | null; why: string; by: string; at: string }>(
    db,
    sql`select c.id::int as id, c.code, c.name, c.kind, c.city, c.delete_why as why, p.name as by, ${iso("c.delete_asked_at")} as at
      from mr_client c join person p on p.id = c.delete_asked_by where c.active and c.delete_asked_at is not null
      order by c.delete_asked_at`,
  );
}

/** A client's page: details, the last five visits, how many calls, the orders booked. */
export async function clientPage(db: Database, me: Me, id: number): Promise<ClientPage> {
  const access = await mustUse(db, me);
  const [found] = await rows<{ row: ClientPage["client"] }>(
    db,
    sql`select (${clientJson})::jsonb || jsonb_build_object('dispensing', c.dispensing, 'qualification', c.qualification,
        'registrationNo', c.registration_no, 'gender', c.gender, 'hospitalType', c.hospital_type, 'hospitalClass', c.hospital_class,
        'firmType', c.firm_type, 'contactPerson', c.contact_person, 'phone', c.phone, 'email', c.email, 'address', c.address,
        'worksAt', c.works_at, 'firmId', c.firm_id, 'visitsAMonth', c.visits_a_month, 'note', c.note, 'pin', c.pin, 'active', c.active,
        'addedBy', (select name from person where id = c.added_by), 'addedAt', ${iso("c.added_at")},
        'worksAtName', (select name from mr_client where id = c.works_at), 'firmName', (select name from mr_client where id = c.firm_id)) as row
      from mr_client c where c.id = ${id}`,
  );
  if (!found) throw new Refusal(404, "not_found", "No such client.");
  const client = found.row;
  const [history, orders, calls, lead] = await Promise.all([
    lastVisits(db, id),
    orderRows(db, sql`o.client_id = ${id}`, 10),
    rows<{ n: number }>(db, sql`select count(*)::int as n from mr_visit where client_id = ${id} and status = 'done'`),
    isLeadNow(db, me),
  ]);
  const member = access === "mr" || access === "lead";
  const own = client.assignedTo?.id === me.id;
  return {
    client,
    history,
    orders,
    calls: calls[0]?.n ?? 0,
    can: {
      edit: client.active && (lead || (member && own)),
      assign: lead && client.active,
      deactivate: lead && client.active,
      visit: member && client.active && !me.viewedBy,
      order: member && client.active && !me.viewedBy,
    },
  };
}

/** The whole visit history of a client (SEFMED's Call history), newest first. */
export async function callHistory(db: Database, me: Me, id: number): Promise<ClientPage["history"]> {
  await mustUse(db, me);
  return rows<ClientPage["history"][number]>(
    db,
    sql`select v.id::int as id, to_char(v.day, 'YYYY-MM-DD') as day, p.name as person, v.status,
        ${iso("v.checked_in_at")} as "checkedInAt", ${iso("v.done_at")} as "doneAt", to_json(v.objectives) as objectives,
        v.objective_note as "objectiveNote", v.meeting, v.outcome, v.feedback, v.notes
      from mr_visit v join person p on p.id = v.person_id where v.client_id = ${id}
      order by v.day desc, v.id desc limit 200`,
  );
}

/** Clients to pick for a day's visits: those in the picked cities (all when none), by kind. */
export async function clientsIn(
  db: Database,
  me: Me,
  asked: { kind?: string | null; cities?: string | null; q?: string | null },
): Promise<ClientList["rows"]> {
  await mustUse(db, me);
  void accessOf;
  const kind = (CLIENT_KINDS as string[]).includes(asked.kind ?? "") ? (asked.kind as ClientKind) : "doctor";
  const cities = (asked.cities ?? "").split("|").map((one) => one.trim().toLowerCase()).filter(Boolean);
  const find = clean(asked.q)?.toLowerCase();
  const today = todayManila();
  const found = await rows<{ row: ClientList["rows"][number] }>(
    db,
    sql`select (${clientJson})::jsonb || jsonb_build_object(
        'lastVisit', (select to_char(max(v.day), 'YYYY-MM-DD') from mr_visit v where v.client_id = c.id and v.status = 'done'),
        'nextVisit', (select to_char(min(v.day), 'YYYY-MM-DD') from mr_visit v where v.client_id = c.id and v.status = 'planned' and v.day >= ${today}::date),
        'visitsThisMonth', 0) as row
      from mr_client c where c.active and c.kind = ${kind}
        ${cities.length ? sql`and lower(coalesce(c.city, '')) in (${sql.join(cities.map((one) => sql`${one}`), sql`, `)})` : sql``}
        ${find ? sql`and (lower(c.name) like ${`%${find}%`} or lower(c.code) like ${`%${find}%`})` : sql``}
      order by c.assigned_to = ${me.id} desc, c.name limit 300`,
  );
  return found.map((one) => one.row);
}
