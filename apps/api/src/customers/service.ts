// Customers: every hospital, doctor, patient and business buyer, each kept once. A MedRep sees
// the customers of their own area (and any they added); a team lead or manager those of the
// people under them; everyone else, all of them.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { addDays, EXPIRING_DAYS, todayManila } from "../inventory/rules";
import { clean, day, iso, type Runner } from "../inventory/service";
import { inForce } from "../org/service";
import type { Role } from "../people/roles";
import { formatPhone } from "../phone";
import type {
  CustomerCan,
  CustomerDetail,
  CustomerInput,
  CustomerKind,
  CustomerList,
  CustomerMatch,
  CustomerRow,
  Me,
  MyArea,
  ToCollect,
} from "../types";

export const CUSTOMER_KINDS: CustomerList["kinds"] = [
  { key: "hospital", label: "Hospital", plural: "Hospitals" },
  { key: "doctor", label: "Doctor", plural: "Doctors" },
  { key: "patient", label: "Patient", plural: "Patients" },
  { key: "drugstore", label: "Drugstore", plural: "Drugstores" },
  { key: "distributor", label: "Distributor", plural: "Distributors" },
  { key: "government", label: "Government buyer", plural: "Government buyers" },
];

/** Who adds a customer and keeps its contact details right. */
export const CUSTOMER_ADD_ROLES: readonly Role[] = [
  "medrep",
  "team_lead",
  "manager",
  "management",
  "online",
  "admin",
];
/** Who sets the area, the payment terms and the credit limit, and reviews new customers. */
export const CUSTOMER_MANAGE_ROLES: readonly Role[] = ["management", "admin"];

/** Who sets a customer's payment terms and credit limit: Management, and Finance who collects. */
export const CUSTOMER_CREDIT_ROLES: readonly Role[] = ["management", "finance", "admin"];

export const customerCan = (me: Me): CustomerCan => ({
  add: CUSTOMER_ADD_ROLES.includes(me.role),
  manage: CUSTOMER_MANAGE_ROLES.includes(me.role),
  credit: CUSTOMER_CREDIT_ROLES.includes(me.role),
});

export const PAGE_SIZE = 50;

/** The phone's last ten digits: 0917 555 0142, +63 917 555 0142 and 639175550142 are one number. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

const maskPhone = (phone: string | null) => {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : null;
};

/** The person and everyone under them, down the reporting line. Used by `seen`. */
export const team = (me: Me): SQL => sql`
  with recursive team as (
    select id from person where id = ${me.id}
    union all
    select p.id from person p join team t on p.reports_to = t.id
  )`;

/** The areas of the seats a person sits in or covers today. */
const seatAreasOf = (
  me: Me,
): SQL => sql`(select s.area_id from seat s join seat_holder h on h.seat_id = s.id
  where h.person_id = ${me.id} and s.active and s.area_id is not null and ${inForce("h", todayManila())})`;

/** Every area of a seat under the team, an empty seat's too: its customers wait with the lead. */
const teamSeatAreas = sql`(select s.area_id from seat s
  where s.active and s.area_id is not null and s.boss_id in (select id from team))`;

/** Which customers (alias `c`) this person may see. Needs `team` in front of the query. */
export function seen(me: Me): SQL {
  if (me.role === "medrep")
    return sql`(c.added_by = ${me.id} ${me.area ? sql`or c.area_id = ${me.area.id}` : sql``}
      or c.area_id in ${seatAreasOf(me)})`;
  if (me.role === "team_lead" || me.role === "manager")
    return sql`(c.added_by in (select id from team)
      or c.area_id in (select area_id from person where id in (select id from team) and area_id is not null)
      or c.area_id in ${teamSeatAreas})`;
  // The Online desk: patients, and the customers of its own enquiries and orders; not every
  // hospital's money.
  if (me.role === "online")
    return sql`(c.kind = 'patient' or c.added_by = ${me.id}
      or exists (select 1 from lead l where l.customer_id = c.id)
      or exists (select 1 from sales_order o where o.customer_id = c.id and (o.lead_id is not null or o.medrep_id = ${me.id} or o.raised_by = ${me.id})))`;
  return sql`true`;
}

/** What a customer (alias `c`) owes: every open invoice, cash on delivery once delivered; past
 *  due by its due day (credit counts from delivery). */
const owedOf = sql`(select coalesce(sum(i.total - i.paid), 0)::int from invoice i join sales_order o on o.id = i.order_id
  where i.customer_id = c.id and i.status = 'open' and not (i.terms = 'cod' and o.status <> 'completed'))`;
const overdueOf = (
  today: string,
) => sql`(select coalesce(sum(i.total - i.paid), 0)::int from invoice i join sales_order o on o.id = i.order_id
  where i.customer_id = c.id and i.status = 'open' and i.due_on < ${today}::date
    and not (i.terms in ('cod', 'days') and o.status <> 'completed'))`;
const lastOrderOf = sql`(select max(o.created_at) from sales_order o where o.customer_id = c.id and o.status not in ('draft', 'cancelled'))`;

/** How a list of customers is ordered: by name, who owes most, the latest order, or the longest
 *  without one (never ordered first). */
const byName = () => sql`lower(c.name), c.id`;
const SORTS: Record<string, (today: string) => SQL> = {
  name: byName,
  owed: () => sql`${owedOf} desc, lower(c.name), c.id`,
  overdue: (today) => sql`${overdueOf(today)} desc, ${owedOf} desc, lower(c.name), c.id`,
  recent: () => sql`${lastOrderOf} desc nulls last, lower(c.name), c.id`,
  quiet: () => sql`${lastOrderOf} asc nulls first, lower(c.name), c.id`,
};

/** Who holds the customer's area today. */
const holder = sql`(select string_agg(p.name, ', ' order by p.name) from person p
  where p.area_id = c.area_id and p.role = 'medrep' and p.active)`;

/** Who looks after each customer (alias `c`): their area's MedRep (`u`), else, for a patient
 * with no area, whoever works their latest enquiry (`d`). `under` is that person's id. */
const lookedAfter = sql`
  left join lateral (select p.id, p.name, ch.code as channel, pa.name as area from person p
      left join channel ch on ch.id = p.channel_id left join area pa on pa.id = p.area_id
    where p.area_id = c.area_id and p.role = 'medrep' and p.active order by p.name limit 1) u on true
  left join lateral (select p.id, p.name, ch.code as channel from lead l join person p on p.id = l.assigned_to
      left join channel ch on ch.id = p.channel_id
    where l.customer_id = c.id order by l.first_contact_at desc limit 1) d on true`;
const under = sql`coalesce(u.id, d.id)`;

// ---------------------------------------------------------------- reading

export async function listCustomers(
  db: Database,
  me: Me,
  filter: {
    kind?: CustomerKind;
    q?: string;
    page?: number;
    review?: boolean;
    medrep?: number;
    seat?: number;
    sort?: string;
    /** Only those who owe money (past due, when "overdue"). */
    owes?: "any" | "overdue";
  },
): Promise<CustomerList> {
  const today = todayManila();
  const page = Math.max(1, filter.page ?? 1);
  const words = (filter.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  const conditions: SQL[] = [sql`c.active`, seen(me)];
  if (filter.kind) conditions.push(sql`c.kind = ${filter.kind}`);
  if (filter.review) conditions.push(sql`c.review = 'to_review'`);
  if (filter.owes === "any") conditions.push(sql`${owedOf} > 0`);
  if (filter.owes === "overdue") conditions.push(sql`${overdueOf(today)} > 0`);
  // One seat's customers: those of its area (a lead's person page, an empty seat's too).
  if (filter.seat)
    conditions.push(sql`c.area_id = (select s.area_id from seat s where s.id = ${filter.seat})`);
  for (const word of words) {
    const like = `%${word.replace(/[%_\\]/g, "\\$&")}%`;
    const digits = word.replace(/\D/g, "");
    conditions.push(
      digits.length >= 4
        ? sql`(lower(c.name) like ${like} or c.phone_key like ${`%${digits.slice(-10)}%`} or lower(c.code) like ${like})`
        : sql`(lower(c.name) like ${like} or lower(coalesce(c.city, '')) like ${like} or lower(c.code) like ${like}
               or lower(coalesce(c.specialty, '')) like ${like})`,
    );
  }
  // The MedRep strip counts everyone in the other filters, so a MedRep can be picked from it.
  const everyRep = sql.join(conditions, sql` and `);
  if (filter.medrep) conditions.push(sql`${under} = ${filter.medrep}`);
  const where = sql.join(conditions, sql` and `);
  const kindScope = filter.kind
    ? sql`c.active and ${seen(me)} and c.kind = ${filter.kind}`
    : sql`c.active and ${seen(me)}`;
  const placed = sql`o.customer_id = c.id and o.status not in ('draft', 'cancelled')`;

  const [list, counted, byKind, byRep, summary] = await Promise.all([
    rows<CustomerRow>(
      db,
      sql`${team(me)}
          select c.id::int as id, c.code, c.kind, c.name, c.phone, c.city, a.name as area, ${holder} as medrep,
            c.specialty, h.name as "worksAt", c.review,
            -- Whom the area's MedRep reports to: the customer is "under" them too.
            (select m.name from person p join person m on m.id = p.reports_to
              where p.area_id = c.area_id and p.role = 'medrep' and p.active order by p.name limit 1) as manager,
            -- A patient with no area is looked after by whoever works their latest enquiry.
            (select a2.name from lead l join person a2 on a2.id = l.assigned_to
              where l.customer_id = c.id order by l.first_contact_at desc limit 1) as "deskOwner",
            (select count(*)::int from sales_order o where o.customer_id = c.id and o.status not in ('draft', 'cancelled')) as orders,
            ${iso("(select max(o.created_at) from sales_order o where o.customer_id = c.id and o.status not in ('draft', 'cancelled'))")} as "lastOrderAt",
            ${owedOf} as owed, ${overdueOf(today)} as overdue, c.credit_limit::int as "creditLimit"
          from customer c
          left join area a on a.id = c.area_id
          left join customer h on h.id = c.works_at
          ${lookedAfter}
          where ${where}
          order by ${(SORTS[filter.sort ?? "name"] ?? byName)(today)}
          limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`,
    ),
    rows<{ count: number }>(
      db,
      sql`${team(me)} select count(*)::int as count from customer c ${lookedAfter} where ${where}`,
    ),
    rows<{ kind: CustomerKind; count: number }>(
      db,
      sql`${team(me)} select c.kind, count(*)::int as count from customer c where c.active and ${seen(me)} group by c.kind`,
    ),
    rows<CustomerList["byRep"][number] & { none: boolean }>(
      db,
      sql`${team(me)} select ${under}::int as id, coalesce(u.name, d.name) as name,
          coalesce(u.channel, d.channel) as channel, u.area, count(*)::int as count,
          (${under} is null) as none
        from customer c ${lookedAfter} where ${everyRep}
        group by ${under}, coalesce(u.name, d.name), coalesce(u.channel, d.channel), u.area
        order by count(*) desc, coalesce(u.name, d.name)`,
    ),
    rows<CustomerList["summary"]>(
      db,
      sql`${team(me)} select count(*)::int as "all",
          count(*) filter (where c.review = 'to_review')::int as "toCheck",
          count(*) filter (where exists (select 1 from sales_order o where ${placed}
            and date_trunc('month', o.created_at at time zone 'Asia/Manila') = date_trunc('month', now() at time zone 'Asia/Manila')))::int as "orderedThisMonth",
          count(*) filter (where not exists (select 1 from sales_order o where ${placed}))::int as "neverOrdered"
        from customer c where ${kindScope}`,
    ),
  ]);

  return {
    can: customerCan(me),
    kinds: CUSTOMER_KINDS,
    counts: Object.fromEntries(byKind.map((row) => [row.kind, row.count])),
    total: counted[0]?.count ?? 0,
    page,
    pageSize: PAGE_SIZE,
    rows: list,
    byRep: byRep.filter((row) => !row.none).map(({ none: _none, ...row }) => row),
    unassigned: byRep.find((row) => row.none)?.count ?? 0,
    summary: summary[0] ?? { all: 0, toCheck: 0, orderedThisMonth: 0, neverOrdered: 0 },
  };
}

export async function customerDetail(db: Database, me: Me, id: number): Promise<CustomerDetail> {
  const today = todayManila();
  const [found, doctors, areas] = await Promise.all([
    rows<CustomerDetail["customer"] & { licenceExpires: string | null }>(
      db,
      sql`${team(me)}
          select c.id::int as id, c.code, c.kind, c.name, c.phone, c.email, c.address, c.city,
            c.specialty, c.works_at::int as "worksAtId", h.name as "worksAt",
            c.licence_no as "licenceNo", ${day("c.licence_expires")} as "licenceExpires", c.tin, c.note,
            c.area_id::int as "areaId", a.name as area, ch.code as channel, ${holder} as medrep,
            c.payment_terms as "paymentTerms", c.payment_days::int as "paymentDays", c.credit_limit::int as "creditLimit",
            c.review, r.name as "reviewedBy", p.name as "addedBy", ${iso("c.created_at")} as "addedAt",
            (select to_char(max(o.created_at) at time zone 'Asia/Manila', 'YYYY-MM-DD') from sales_order o
              where o.customer_id = c.id and o.status <> 'cancelled') as "lastOrderOn",
            coalesce(c.area_id = ${me.area?.id ?? null}, false) as "inMyArea",
            ${owedOf} as owed, ${overdueOf(today)} as overdue,
            coalesce((select max(${today}::date - i.due_on)::int from invoice i join sales_order o on o.id = i.order_id
              where i.customer_id = c.id and i.status = 'open' and i.due_on < ${today}::date
                and not (i.terms in ('cod', 'days') and o.status <> 'completed')), 0) as "overdueDays"
          from customer c
          left join area a on a.id = c.area_id
          left join channel ch on ch.id = a.channel_id
          left join customer h on h.id = c.works_at
          left join person r on r.id = c.reviewed_by
          join person p on p.id = c.added_by
          where c.id = ${id} and c.active and ${seen(me)}`,
    ),
    rows<CustomerDetail["doctors"][number]>(
      db,
      sql`select id::int as id, name, specialty from customer where works_at = ${id} and active order by lower(name) limit 100`,
    ),
    rows<CustomerDetail["areas"][number]>(
      db,
      sql`select a.id::int as id, a.name, ch.code as channel from area a join channel ch on ch.id = a.channel_id order by a.name`,
    ),
  ]);
  const customer = found[0];
  if (!customer) throw new Refusal(404, "not_found", "No such customer, or it isn't one of yours.");
  const expires = customer.licenceExpires;
  const licenceState = !customer.licenceNo
    ? "none"
    : expires && expires < today
      ? "expired"
      : expires && expires <= addDays(today, EXPIRING_DAYS)
        ? "soon"
        : "ok";
  return {
    can: customerCan(me),
    today,
    kinds: CUSTOMER_KINDS,
    areas,
    customer: { ...customer, licenceState },
    doctors,
  };
}

/**
 * Is this someone we already know? Looks at EVERY customer, whoever looks after it, by the
 * phone number or the name, and answers just enough to recognise them.
 */
export async function checkCustomer(
  db: Database,
  me: Me,
  input: { name?: string; phone?: string; kind?: CustomerKind },
): Promise<CustomerMatch[]> {
  const key = phoneKey(input.phone);
  const name = (input.name ?? "").trim().toLowerCase();
  if (!key && name.length < 3) return [];
  const like = `%${name.replace(/[%_\\]/g, "\\$&")}%`;
  const byPhone = key ? sql`c.phone_key = ${key}` : sql`false`;
  const byName = name.length >= 3 ? sql`lower(c.name) like ${like}` : sql`false`;
  const found = await rows<Omit<CustomerMatch, "why"> & { phoneHit: boolean }>(
    db,
    sql`${team(me)}
        select c.id::int as id, c.kind, c.name, c.city, c.phone, ${holder} as medrep,
          coalesce((${seen(me)}), false) as mine, (${byPhone}) as "phoneHit"
        from customer c
        where c.active and (${byPhone} or ${byName})
        order by "phoneHit" desc, (c.kind = ${input.kind ?? ""}::text) desc, lower(c.name)
        limit 8`,
  );
  return found.map(({ phoneHit, phone, ...match }) => ({
    ...match,
    phone: maskPhone(phone),
    why: phoneHit ? "phone" : "name",
  }));
}

export async function myArea(db: Database, me: Me): Promise<MyArea> {
  const [byKind, review, quiet, line] = await Promise.all([
    rows<{ kind: CustomerKind; count: number }>(
      db,
      sql`${team(me)} select c.kind, count(*)::int as count from customer c where c.active and ${seen(me)} group by c.kind`,
    ),
    rows<{ count: number }>(
      db,
      sql`${team(me)} select count(*)::int as count from customer c where c.active and c.review = 'to_review' and ${seen(me)}`,
    ),
    rows<{ count: number }>(
      db,
      sql`${team(me)} select count(*)::int as count from customer c
        where c.active and c.kind <> 'patient' and ${seen(me)}
          and not exists (select 1 from sales_order o where o.customer_id = c.id and o.status <> 'cancelled'
            and o.created_at >= now() - interval '60 days')`,
    ),
    rows<{ name: string; title: string | null }>(
      db,
      sql`with recursive up as (
          select p.reports_to as id, 1 as depth from person p where p.id = ${me.id}
          union all
          select p.reports_to, up.depth + 1 from person p join up on p.id = up.id where up.depth < 6
        )
        select p.name, p.title from up join person p on p.id = up.id where p.role not in ('ceo', 'admin') order by up.depth`,
    ),
  ]);
  return {
    area: me.area ? { ...me.area, channel: me.channel?.code ?? null } : null,
    counts: Object.fromEntries(byKind.map((row) => [row.kind, row.count])),
    toReview: review[0]?.count ?? 0,
    quiet: quiet[0]?.count ?? 0,
    line: line.map((person) => (person.title ? `${person.name}, ${person.title}` : person.name)),
  };
}

// ---------------------------------------------------------------- writing

async function hospitalOrNull(
  tx: Runner,
  id: number | null | undefined,
  self?: number,
): Promise<number | null> {
  if (!id) return null;
  const [found] = await rows<{ kind: string }>(
    tx,
    sql`select kind from customer where id = ${id} and active`,
  );
  if (!found || found.kind !== "hospital" || id === self)
    throw new Refusal(400, "invalid", "Pick a hospital.", "worksAt");
  return id;
}

/** The area a new customer falls in: the adder's own, else the one area that names its city. */
async function areaFor(tx: Runner, me: Me, city: string | null): Promise<number | null> {
  if (me.role === "medrep" && me.area) return me.area.id;
  if (!city) return null;
  const found = await rows<{ id: number }>(
    tx,
    sql`select id::int as id from area where exists (select 1 from unnest(cities) as place where lower(place) = ${city.toLowerCase()})`,
  );
  return found.length === 1 ? (found[0]?.id as number) : null;
}

function termsOf(input: CustomerInput): { terms: string; days: number | null } {
  const terms = input.paymentTerms ?? "advance";
  if (terms !== "days") return { terms, days: null };
  if (!input.paymentDays)
    throw new Refusal(400, "invalid", "Say how many days they have to pay.", "paymentDays");
  return { terms, days: input.paymentDays };
}

/**
 * A customer is known by their phone number (and then by their CUS number): the same number
 * can't be a second customer of the same kind. Two people adding the same number at the same
 * moment are put one after the other by a lock on the number, so only the first gets in.
 */
async function samePhoneRefused(
  tx: Runner,
  kind: CustomerKind,
  key: string | null,
  except: number | null,
): Promise<void> {
  if (!key) return;
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`customer-phone:${kind}:${key}`}, 0))`,
  );
  const [twin] = await rows<{ name: string; code: string; medrep: string | null }>(
    tx,
    sql`select c.name, c.code, ${holder} as medrep from customer c
        where c.active and c.kind = ${kind} and c.phone_key = ${key} and c.id <> ${except ?? 0}
        order by c.id limit 1`,
  );
  if (twin)
    throw new Refusal(
      409,
      "duplicate",
      `That number is already ${twin.name} (${twin.code})${twin.medrep ? `, looked after by ${twin.medrep}` : ""}. Open them instead of adding them again.`,
      "phone",
    );
}

/** Adds a customer. A hospital, doctor or business is listed once per city. */
export async function addCustomer(db: Database, me: Me, input: CustomerInput): Promise<number> {
  const can = customerCan(me);
  const name = input.name.trim();
  const city = clean(input.city);
  return db.transaction(async (tx) => {
    await samePhoneRefused(tx, input.kind, phoneKey(input.phone), null);
    if (input.kind !== "patient") {
      const twin = await rows<{ medrep: string | null }>(
        tx,
        sql`select ${holder} as medrep from customer c
            where c.kind = ${input.kind} and lower(c.name) = ${name.toLowerCase()} and lower(coalesce(c.city, '')) = ${(city ?? "").toLowerCase()}`,
      );
      if (twin.length)
        throw new Refusal(
          409,
          "duplicate",
          `${name}${city ? ` in ${city}` : ""} is already a customer${twin[0]?.medrep ? `, looked after by ${twin[0].medrep}` : ""}.`,
          "name",
        );
    }
    const worksAt = input.kind === "doctor" ? await hospitalOrNull(tx, input.worksAt) : null;
    const areaId =
      can.manage && input.areaId !== undefined ? input.areaId : await areaFor(tx, me, city);
    const { terms, days } = can.manage ? termsOf(input) : { terms: "advance", days: null };

    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into customer (kind, name, phone, phone_key, email, address, city, area_id, specialty, works_at,
            licence_no, licence_expires, tin, payment_terms, payment_days, credit_limit, note, review, added_by)
          values (${input.kind}, ${name}, ${formatPhone(input.phone)}, ${phoneKey(input.phone)}, ${clean(input.email)},
            ${clean(input.address)}, ${city}, ${areaId}, ${clean(input.specialty)}, ${worksAt},
            ${clean(input.licenceNo)}, ${clean(input.licenceExpires)}::date, ${clean(input.tin)},
            ${terms}, ${days}, ${can.manage ? (input.creditLimit ?? null) : null}, ${clean(input.note)},
            ${can.manage ? "ok" : "to_review"}, ${me.id})
          returning id::int as id`,
    );
    const id = made?.id as number;
    await tx.execute(
      sql`update customer set code = 'CUS-' || lpad(id::text, 5, '0') where id = ${id}`,
    );
    return id;
  });
}

/** Changes a customer the person can see. Area, terms and credit only by those who manage customers. */
export async function saveCustomer(
  db: Database,
  me: Me,
  id: number,
  input: CustomerInput,
): Promise<void> {
  const can = customerCan(me);
  const name = input.name.trim();
  const city = clean(input.city);
  await db.transaction(async (tx) => {
    const [now] = await rows<{ kind: CustomerKind }>(
      tx,
      sql`${team(me)} select c.kind from customer c where c.id = ${id} and c.active and ${seen(me)} for update of c`,
    );
    if (!now) throw new Refusal(404, "not_found", "No such customer, or it isn't one of yours.");
    await samePhoneRefused(tx, now.kind, phoneKey(input.phone), id);
    if (now.kind !== "patient") {
      const twin = await rows(
        tx,
        sql`select 1 from customer where kind = ${now.kind} and lower(name) = ${name.toLowerCase()}
              and lower(coalesce(city, '')) = ${(city ?? "").toLowerCase()} and id <> ${id}`,
      );
      if (twin.length)
        throw new Refusal(
          409,
          "duplicate",
          `${name}${city ? ` in ${city}` : ""} is already a customer.`,
          "name",
        );
    }
    const worksAt = now.kind === "doctor" ? await hospitalOrNull(tx, input.worksAt, id) : null;
    await tx.execute(
      sql`update customer set name = ${name}, phone = ${formatPhone(input.phone)}, phone_key = ${phoneKey(input.phone)},
            email = ${clean(input.email)}, address = ${clean(input.address)}, city = ${city},
            specialty = ${clean(input.specialty)}, works_at = ${worksAt},
            licence_no = ${clean(input.licenceNo)}, licence_expires = ${clean(input.licenceExpires)}::date,
            tin = ${clean(input.tin)}, note = ${clean(input.note)}
          where id = ${id}`,
    );
    if (can.manage) {
      const { terms, days } = termsOf(input);
      await tx.execute(
        sql`update customer set area_id = ${input.areaId ?? null}, payment_terms = ${terms}, payment_days = ${days},
              credit_limit = ${input.creditLimit ?? null}
            where id = ${id}`,
      );
    }
  });
}

export async function reviewCustomer(db: Database, me: Me, id: number): Promise<void> {
  const done = await rows(
    db,
    sql`update customer set review = 'ok', reviewed_by = ${me.id}, reviewed_at = now()
        where id = ${id} and active and review = 'to_review' returning id`,
  );
  if (!done.length) throw new Refusal(409, "reviewed", "This customer was already reviewed.");
}

/** The MedRep's money to collect: open invoices on his orders (cash on delivery once delivered),
 *  by how late, oldest first. A lead sees his team's. */
export async function toCollect(db: Database, me: Me): Promise<ToCollect> {
  const today = todayManila();
  const whose =
    me.role === "team_lead" || me.role === "manager"
      ? sql`(o.medrep_id in (select id from team) or o.raised_by in (select id from team))`
      : sql`(o.medrep_id = ${me.id} or o.raised_by = ${me.id})`;
  const found = await rows<ToCollect["rows"][number]>(
    db,
    sql`${team(me)} select i.id::int as "invoiceId", i.code as "invoiceCode", o.id::int as "orderId", o.code as "orderCode",
        c.id::int as "customerId", c.name as customer, (i.total - i.paid)::int as balance, ${day("i.due_on")} as "dueOn",
        coalesce(${today}::date - i.due_on, 0)::int as "daysLate"
      from invoice i join sales_order o on o.id = i.order_id join customer c on c.id = i.customer_id
      where i.status = 'open' and i.total > i.paid and not (i.terms = 'cod' and o.status <> 'completed') and ${whose}
      order by i.due_on nulls last, i.id limit 200`,
  );
  const bucket = (
    key: ToCollect["buckets"][number]["key"],
    label: string,
    test: (d: number) => boolean,
  ) => {
    const inIt = found.filter((row) => test(row.daysLate));
    return {
      key,
      label,
      amount: inIt.reduce((sum, row) => sum + row.balance, 0),
      invoices: inIt.length,
    };
  };
  return {
    total: found.reduce((sum, row) => sum + row.balance, 0),
    buckets: [
      bucket("not_due", "Not due yet", (d) => d <= 0),
      bucket("d30", "1–30 days late", (d) => d > 0 && d <= 30),
      bucket("d60", "31–60 days late", (d) => d > 30 && d <= 60),
      bucket("older", "Over 60 days", (d) => d > 60),
    ],
    rows: found,
  };
}

/** Finance (or Management) changes how a customer pays: the terms, their days, the credit limit.
 *  Orders already placed keep theirs; new orders take these. */
export async function saveCustomerCredit(
  db: Database,
  me: Me,
  id: number,
  input: Pick<CustomerInput, "paymentTerms" | "paymentDays" | "creditLimit">,
): Promise<void> {
  allow(me, CUSTOMER_CREDIT_ROLES, "change a customer's terms or credit limit");
  await customerDetail(db, me, id);
  const { terms, days } = termsOf(input as CustomerInput);
  if (input.creditLimit != null && input.creditLimit < 0)
    throw new Refusal(400, "invalid", "The credit limit can't be below zero.", "creditLimit");
  await db.execute(
    sql`update customer set payment_terms = ${terms}, payment_days = ${days}, credit_limit = ${input.creditLimit ?? null}
      where id = ${id}`,
  );
}
