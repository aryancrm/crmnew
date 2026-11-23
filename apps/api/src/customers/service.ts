// Customers: every hospital, doctor, patient and business buyer, each kept once. A MedRep sees
// the customers of their own area (and any they added); a team lead or manager those of the
// people under them; everyone else, all of them.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { duesSql } from "../finance/dues";
import { allow, may, onlineDesk, Refusal } from "../http";
import { addDays, EXPIRING_DAYS, todayManila } from "../inventory/rules";
import { clean, day, iso, type Runner } from "../inventory/service";
import { inForce } from "../org/service";
import type { Role } from "../people/roles";
import { bytesOf, keepFile } from "../files/store";
import { formatPhone } from "../phone";
import type {
  CustomerCan,
  CustomerDetail,
  CustomerInput,
  CustomerKind,
  CustomerPaperKind,
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

/** A business customer's papers, as the hub asked for them. */
export const CUSTOMER_PAPER_LABEL: Record<CustomerPaperKind, string> = {
  bir_2303: "BIR 2303",
  lto_permit: "LTO permit",
  business_permit: "Business permit",
};
export const CUSTOMER_PAPER_KINDS = Object.keys(CUSTOMER_PAPER_LABEL) as CustomerPaperKind[];
/** The kinds that buy as a business with a licence to operate: their licence and papers are
 *  asked for (a hospital's before it is added from the field; the others may follow). */
export const LICENSED_KINDS: readonly CustomerKind[] = ["hospital", "distributor", "drugstore"];

/** What of the hub's list a licensed customer doesn't have yet: the licence's details, the TIN,
 *  the three papers. */
export function missingOf(
  customer: {
    kind: CustomerKind;
    tin: string | null;
    licenceOwner: string | null;
    licenceNo: string | null;
    ltoType: string | null;
    licenceIssued: string | null;
    licenceExpires: string | null;
  },
  papers: CustomerPaperKind[],
): string[] {
  if (!LICENSED_KINDS.includes(customer.kind)) return [];
  return [
    ...(customer.tin ? [] : ["TIN"]),
    ...(customer.licenceOwner ? [] : ["licence owner"]),
    ...(customer.licenceNo ? [] : ["LTO number"]),
    ...(customer.ltoType ? [] : ["LTO type"]),
    ...(customer.licenceIssued ? [] : ["licence issue date"]),
    ...(customer.licenceExpires ? [] : ["licence expiry"]),
    ...CUSTOMER_PAPER_KINDS.filter((kind) => !papers.includes(kind)).map(
      (kind) => CUSTOMER_PAPER_LABEL[kind],
    ),
  ];
}

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
      or c.area_id in ${seatAreasOf(me)}
      or exists (select 1 from lead l where l.customer_id = c.id and l.desk = 'pap' and l.assigned_to = ${me.id})
      or exists (select 1 from b2b_account ba where ba.customer_id = c.id and (ba.nbd_id = ${me.id} or ba.crr_id = ${me.id})))`;
  if (me.role === "team_lead" || me.role === "manager")
    return sql`(c.added_by in (select id from team)
      or c.area_id in (select area_id from person where id in (select id from team) and area_id is not null)
      or c.area_id in ${teamSeatAreas})`;
  // The Online desk: patients, and the customers of its own enquiries and orders; not every
  // hospital's money.
  if (onlineDesk(me))
    return sql`(c.kind = 'patient' or c.added_by = ${me.id}
      or exists (select 1 from lead l where l.customer_id = c.id)
      or exists (select 1 from sales_order o where o.customer_id = c.id and (o.lead_id is not null or o.medrep_id = ${me.id} or o.raised_by = ${me.id})))`;
  return sql`true`;
}

/** What a customer (alias `c`) owes: every open invoice, cash on delivery once delivered; past
 *  due by its due day (credit counts from delivery). Zoho's unpaid invoices and opening balances
 *  with this CRM's. */
const owedOf = (today: string) =>
  sql`(select coalesce(sum(dd.balance), 0)::float8 from ${duesSql(today)} dd where dd.customer_id = c.id and not dd.cod_waiting)`;
const overdueOf = (today: string) =>
  sql`(select coalesce(sum(dd.balance), 0)::float8 from ${duesSql(today)} dd where dd.customer_id = c.id and not dd.on_delivery and dd.late > 0)`;
const lastOrderOf = sql`(select max(o.created_at) from sales_order o where o.customer_id = c.id and o.status not in ('draft', 'cancelled'))`;

/** How a list of customers is ordered: by name, who owes most, the latest order, or the longest
 *  without one (never ordered first). */
const byName = () => sql`lower(c.name), c.id`;
const SORTS: Record<string, (today: string) => SQL> = {
  name: byName,
  owed: (today) => sql`${owedOf(today)} desc, lower(c.name), c.id`,
  overdue: (today) => sql`${overdueOf(today)} desc, ${owedOf(today)} desc, lower(c.name), c.id`,
  recent: () => sql`${lastOrderOf} desc nulls last, lower(c.name), c.id`,
  quiet: () => sql`${lastOrderOf} asc nulls first, lower(c.name), c.id`,
};

/** Who holds the customer's area today. */
const holder = sql`(select string_agg(p.name, ', ' order by p.name) from person p
  where p.area_id = c.area_id and p.role = 'medrep' and p.active)`;

/** Who looks after each customer (alias `c`): their area's MedRep (`u`), else, for a patient
 * with no area, whoever works their latest enquiry (`d`). `under` is that person's id. */
/** The channel a person shows (alias `p`, their first channel `ch`): the target sheet's channel
 *  of their main seat (its Division: CLIDP, MD Telesales, RX Business…), PAP as PAP, else the code. */
const shownChannel = (person: SQL, code: SQL): SQL => sql`(case when ${code} = 'PAP' then ${code} else coalesce((select seat_division(dh.seat_id)
    from seat_holder dh join seat ds on ds.id = dh.seat_id and ds.active
    where dh.person_id = ${person} and dh.starts_on <= (now() at time zone 'Asia/Manila')::date
      and (dh.ends_on is null or dh.ends_on >= (now() at time zone 'Asia/Manila')::date)
    order by (dh.kind = 'holder') desc, ds.lead desc, dh.starts_on, dh.id limit 1), ${code}) end)`;

const lookedAfter = sql`
  -- Each area's MedRep worked out once (the first by name, as before), and each customer's latest
  -- enquiry with an owner worked out once, then both matched to the customers; the enquiry's owner
  -- counts only for a customer with no MedRep. The same answer as asking both for every one of
  -- 90,000 customers, one at a time (22 Nov).
  left join (select distinct on (p.area_id) p.area_id, p.id, p.name, ch.code as channel, pa.name as area from person p
      left join channel ch on ch.id = p.channel_id left join area pa on pa.id = p.area_id
    where p.area_id is not null and p.role = 'medrep' and p.active order by p.area_id, p.name) u on u.area_id = c.area_id
  left join (select distinct on (l.customer_id) l.customer_id, p.id, p.name, ch.code as channel from lead l join person p on p.id = l.assigned_to
      left join channel ch on ch.id = p.channel_id
    where l.customer_id is not null order by l.customer_id, l.first_contact_at desc) d on d.customer_id = c.id and u.id is null`;
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
  if (filter.owes === "any") conditions.push(sql`${owedOf(today)} > 0`);
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
            ${owedOf(today)} as owed, ${overdueOf(today)} as overdue, c.credit_limit::int as "creditLimit"
          from customer c
          left join area a on a.id = c.area_id
          left join customer h on h.id = c.works_at
          ${filter.medrep ? lookedAfter : sql``}
          where ${where}
          order by ${(SORTS[filter.sort ?? "name"] ?? byName)(today)}
          limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`,
    ),
    rows<{ count: number }>(
      db,
      sql`${team(me)} select count(*)::int as count from customer c ${filter.medrep ? lookedAfter : sql``} where ${where}`,
    ),
    rows<{ kind: CustomerKind; count: number }>(
      db,
      sql`${team(me)} select c.kind, count(*)::int as count from customer c where c.active and ${seen(me)} group by c.kind`,
    ),
    rows<CustomerList["byRep"][number] & { none: boolean }>(
      db,
      // Counted first by who looks after them, then each of those few people gets their channel's
      // name: the same rows as naming the channel on every customer, which worked it out 90,000
      // times (22 Nov).
      sql`${team(me)} select x.id, x.name, ${shownChannel(sql`x.id`, sql`x.code`)} as channel, x.area, x.count, x.none from (
          select ${under}::int as id, coalesce(u.name, d.name) as name,
            coalesce(u.channel, d.channel) as code, u.area, count(*)::int as count,
            (${under} is null) as none
          from customer c ${lookedAfter} where ${everyRep}
          group by ${under}, coalesce(u.name, d.name), coalesce(u.channel, d.channel), u.area) x
        order by x.count desc, x.name`,
    ),
    rows<CustomerList["summary"]>(
      db,
      sql`${team(me)} select count(*)::int as "all",
          count(*) filter (where c.review = 'to_review')::int as "toCheck",
          count(*) filter (where c.id in (select o.customer_id from sales_order o where o.status not in ('draft', 'cancelled')
            and date_trunc('month', o.created_at at time zone 'Asia/Manila') = date_trunc('month', now() at time zone 'Asia/Manila')))::int as "orderedThisMonth",
          count(*) filter (where c.id not in (select o.customer_id from sales_order o where o.status not in ('draft', 'cancelled'))
            and c.id not in (select p.customer_id from past_order p where p.status <> 'void'))::int as "neverOrdered"
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
  const [found, doctors, areas, papers] = await Promise.all([
    rows<CustomerDetail["customer"] & { licenceExpires: string | null }>(
      db,
      sql`${team(me)}
          select c.id::int as id, c.code, c.kind, c.name, c.phone, c.email, c.address, c.city,
            c.specialty, c.works_at::int as "worksAtId", h.name as "worksAt",
            c.licence_no as "licenceNo", ${day("c.licence_expires")} as "licenceExpires", c.tin, c.note,
            c.licence_owner as "licenceOwner", c.lto_type as "ltoType", ${day("c.licence_issued")} as "licenceIssued",
            c.area_id::int as "areaId", a.name as area,
            -- The sheet's channel of the seat that has the customer's area; PAP as PAP; else the area's code.
            (case when ch.code = 'PAP' then ch.code else coalesce((select seat_division(ds.id) from seat ds
              where ds.area_id = c.area_id and ds.active order by ds.id limit 1), ch.code) end) as channel, ${holder} as medrep,
            c.payment_terms as "paymentTerms", c.payment_days::int as "paymentDays", c.credit_limit::int as "creditLimit",
            c.review, r.name as "reviewedBy", p.name as "addedBy", ${iso("c.created_at")} as "addedAt",
            -- The last order anywhere: the CRM's own, or the old invoices kept from Zoho (a customer of
            -- years must not read "no order yet" on the order form).
            to_char(greatest(
              (select max(o.created_at at time zone 'Asia/Manila')::date from sales_order o
                where o.customer_id = c.id and o.status <> 'cancelled'),
              (select max(v.issued_on) from sale_invoice v where v.customer_id = c.id and v.status <> 'cancelled')),
              'YYYY-MM-DD') as "lastOrderOn",
            -- A MedRep's own: their area's, and the accounts given to them by name (B2B's NBD and CRR, PAP cases).
            ${me.role === "medrep" ? sql`coalesce((${seen(me)}), false)` : sql`coalesce(c.area_id = ${me.area?.id ?? null}, false)`} as "inMyArea",
            ${owedOf(today)} as owed, ${overdueOf(today)} as overdue,
            coalesce((select max(dd.late)::int from ${duesSql(today)} dd
              where dd.customer_id = c.id and not dd.on_delivery and dd.late > 0), 0) as "overdueDays"
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
    rows<Omit<CustomerDetail["papers"][number], "kindLabel">>(
      db,
      sql`select f.id::int as id, f.kind, f.name, p.name as by, ${iso("f.at")} as at
        from customer_file f join person p on p.id = f.by_person
        where f.customer_id = ${id} and f.active order by f.at, f.id`,
    ),
  ]);
  const customer = found[0];
  if (!customer) throw new Refusal(404, "not_found", "No such customer, or it isn't one of yours.");
  const standing = await standingOf(db, id, customer.kind);
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
    standing,
    papers: papers.map((paper) => ({ ...paper, kindLabel: CUSTOMER_PAPER_LABEL[paper.kind] })),
    missing: missingOf(
      customer,
      papers.map((paper) => paper.kind),
    ),
  };
}

/** What a business customer's channel keeps on it: a hospital's accreditation and formulary, the
 *  tenders it awarded us not yet delivered by an order, a pharmacy's agreed CLIDP prices, a chain's
 *  listings (each the latest line kept). A patient's or a doctor's is empty. */
async function standingOf(db: Database, id: number, kind: string): Promise<CustomerDetail["standing"]> {
  const none: CustomerDetail["standing"] = { accreditation: null, formulary: { approved: 0, requested: 0 }, awards: [], clidpRates: [], listed: 0 };
  if (!["hospital", "government", "drugstore", "distributor"].includes(kind)) return none;
  const [accreditation, formulary, awards, clidpRates, listed] = await Promise.all([
    rows<NonNullable<CustomerDetail["standing"]["accreditation"]>>(
      db,
      sql`select status, ${day("on_day")} as "onDay", ${day("valid_until")} as "validUntil"
        from hospital_accreditation where customer_id = ${id} order by id desc limit 1`,
    ),
    rows<{ approved: number; requested: number }>(
      db,
      sql`select count(*) filter (where status = 'approved')::int as approved, count(*) filter (where status = 'requested')::int as requested
        from (select distinct on (medicine_id) status from hospital_formulary where customer_id = ${id} order by medicine_id, id desc) f`,
    ),
    rows<CustomerDetail["standing"]["awards"][number]>(
      db,
      sql`select id::int as id, code, title, step, ${day("deliver_by")} as "deliverBy" from tender
        where agency_id = ${id} and order_id is null and step in ('won', 'contract') order by noa_on desc nulls last, id desc`,
    ),
    rows<CustomerDetail["standing"]["clidpRates"][number]>(
      db,
      sql`select r.medicine_id::int as "medicineId", m.name || coalesce(' ' || m.strength, '') as medicine, r.unit_price::int as "unitPrice",
          r.moq, ${day("r.agreed_on")} as "agreedOn"
        from clidp_rate r join medicine m on m.id = r.medicine_id
        where r.customer_id = ${id} and r.replaced_at is null order by m.name`,
    ),
    rows<{ count: number }>(
      db,
      sql`select count(*)::int as count from (select distinct on (medicine_id) listed from mt_listing where customer_id = ${id}
          order by medicine_id, id desc) l where l.listed`,
    ),
  ]);
  return {
    accreditation: accreditation[0] ?? null,
    formulary: formulary[0] ?? none.formulary,
    awards,
    clidpRates,
    listed: listed[0]?.count ?? 0,
  };
}

const PAPER_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
const PAPER_MAX_BYTES = 10 * 1024 * 1024;

/** Adds a business customer's paper (BIR 2303, LTO permit, business permit): whoever may see the
 *  customer and adds customers. A newer one is shown first; the older stays. */
export async function addCustomerPaper(
  db: Database,
  me: Me,
  customerId: number,
  paper: { kind: string; name: string; mime: string; bytes: Uint8Array },
): Promise<number> {
  allow(me, CUSTOMER_ADD_ROLES, "add a customer's papers");
  if (!CUSTOMER_PAPER_KINDS.includes(paper.kind as CustomerPaperKind))
    throw new Refusal(400, "invalid", "Say which paper it is.", "kind");
  if (!PAPER_TYPES.includes(paper.mime))
    throw new Refusal(400, "invalid", "Attach a photo or a PDF.", "file");
  if (paper.bytes.byteLength === 0) throw new Refusal(400, "invalid", "That file is empty.", "file");
  if (paper.bytes.byteLength > PAPER_MAX_BYTES)
    throw new Refusal(400, "invalid", "That file is over 10 MB. Take the photo again.", "file");
  const [seenIt] = await rows<{ id: number }>(
    db,
    sql`${team(me)} select c.id::int as id from customer c where c.id = ${customerId} and c.active and ${seen(me)}`,
  );
  if (!seenIt) throw new Refusal(404, "not_found", "No such customer, or it isn't one of yours.");
  const kept = await keepFile("customers", {
    name: paper.name.trim().slice(0, 120) || "paper",
    mime: paper.mime,
    bytes: paper.bytes,
  });
  const [made] = await rows<{ id: number }>(
    db,
    sql`insert into customer_file (customer_id, kind, name, mime, size, data, store_key, by_person)
      values (${customerId}, ${paper.kind}, ${kept.name}, ${kept.mime}, ${kept.size}, ${kept.data}, ${kept.key}, ${me.id})
      returning id::int as id`,
  );
  return made?.id as number;
}

/** A customer's paper, for whoever may see the customer. */
export async function readCustomerPaper(
  db: Database,
  me: Me,
  paperId: number,
): Promise<{ name: string; mime: string; bytes: Uint8Array }> {
  const [paper] = await rows<{
    customerId: number;
    name: string;
    mime: string;
    data: Uint8Array | null;
    key: string | null;
  }>(
    db,
    sql`select customer_id::int as "customerId", name, mime, data, store_key as key from customer_file where id = ${paperId} and active`,
  );
  if (!paper) throw new Refusal(404, "not_found", "That paper isn't there any more.");
  const [seenIt] = await rows<{ id: number }>(
    db,
    sql`${team(me)} select c.id::int as id from customer c where c.id = ${paper.customerId} and ${seen(me)}`,
  );
  if (!seenIt) throw new Refusal(404, "not_found", "That paper isn't there any more.");
  return { name: paper.name, mime: paper.mime, bytes: await bytesOf(paper) };
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
export async function addCustomer(
  db: Database,
  me: Me,
  input: CustomerInput,
  /** prospect: a business B2B Telesales starts to work (its papers make its stage, later). */
  options: { prospect?: boolean } = {},
): Promise<number> {
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
    // The hub's "Hospital Creation Restricted": from the field a hospital comes with its licence
    // whole (its papers follow on the same screen); Management adds one and completes it later.
    if (input.kind === "hospital" && !can.manage && !options.prospect) {
      const lacking = missingOf(
        {
          kind: "hospital",
          tin: clean(input.tin),
          licenceOwner: clean(input.licenceOwner),
          licenceNo: clean(input.licenceNo),
          ltoType: clean(input.ltoType),
          licenceIssued: clean(input.licenceIssued),
          licenceExpires: clean(input.licenceExpires),
        },
        [...CUSTOMER_PAPER_KINDS],
      );
      if (lacking.length)
        throw new Refusal(
          400,
          "invalid",
          `A hospital is added with its ${lacking.join(", ")}.`,
          lacking[0] === "TIN" ? "tin" : "licenceNo",
        );
    }
    const worksAt = input.kind === "doctor" ? await hospitalOrNull(tx, input.worksAt) : null;
    const areaId =
      can.manage && input.areaId !== undefined ? input.areaId : await areaFor(tx, me, city);
    const { terms, days } = can.manage ? termsOf(input) : { terms: "advance", days: null };

    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into customer (kind, name, phone, phone_key, email, address, city, area_id, specialty, works_at,
            licence_no, licence_expires, tin, licence_owner, lto_type, licence_issued,
            payment_terms, payment_days, credit_limit, note, review, added_by)
          values (${input.kind}, ${name}, ${formatPhone(input.phone)}, ${phoneKey(input.phone)}, ${clean(input.email)},
            ${clean(input.address)}, ${city}, ${areaId}, ${clean(input.specialty)}, ${worksAt},
            ${clean(input.licenceNo)}, ${clean(input.licenceExpires)}::date, ${clean(input.tin)},
            ${clean(input.licenceOwner)}, ${clean(input.ltoType)}, ${clean(input.licenceIssued)}::date,
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
            tin = ${clean(input.tin)}, note = ${clean(input.note)},
            licence_owner = ${clean(input.licenceOwner)}, lto_type = ${clean(input.ltoType)},
            licence_issued = ${clean(input.licenceIssued)}::date
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
