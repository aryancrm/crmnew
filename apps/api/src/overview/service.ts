// What Home shows, the stock ledger as lists, and the search box in the top bar. Reads only.

import { type SQL, sql } from "drizzle-orm";
import { listCustomers } from "../customers/service";
import { type Database, rows } from "../db/index";
import { may } from "../http";
import { COST_ROLES, inventoryCan, todayManila } from "../inventory/rules";
import { day, iso, listInventory } from "../inventory/service";
import { findOrders } from "../orders/service";
import { ROLE_LABEL, type Role } from "../people/roles";
import type {
  ChannelPerson,
  ChannelReport,
  Me,
  MoveKind,
  MoveList,
  MoveRow,
  Overview,
  SearchResult,
} from "../types";

const MOVE_PAGE = 50;

/** One ledger line with the names a person reads. `m` is the move. */
const moveColumns = sql`
  m.id::int as id, ${iso("m.at")} as at, m.kind, m.medicine_id::int as "medicineId",
  med.name || coalesce(' ' || med.strength, '') as medicine, med.unit,
  b.batch_no as "batchNo", ${day("b.expires_on")} as "expiresOn",
  w.name as warehouse, m.qty::int as qty, m.ref, m.note, p.name as by`;

const moveJoins = sql`
  join medicine med on med.id = m.medicine_id
  join batch b on b.id = m.batch_id
  join warehouse w on w.id = m.warehouse_id
  join person p on p.id = m.by_person`;

/** Which ledger lines each list holds. A transfer is its "out" line; where it went is joined. */
const KIND_FILTER: Record<MoveKind, SQL> = {
  adjust: sql`m.kind = 'count'`,
  transfer: sql`m.kind = 'move_out'`,
  receive: sql`m.kind = 'receive'`,
};

export async function listMoves(db: Database, kind: MoveKind, page: number): Promise<MoveList> {
  const current = Math.max(1, Math.floor(page) || 1);
  const where = KIND_FILTER[kind];
  const [list, counted] = await Promise.all([
    rows<MoveRow>(
      db,
      sql`select ${moveColumns},
          (select w2.name from stock_move i join warehouse w2 on w2.id = i.warehouse_id
            where i.kind = 'move_in' and i.batch_id = m.batch_id and i.at = m.at and i.qty = -m.qty
            limit 1) as "toWarehouse"
        from stock_move m ${moveJoins}
        where ${where}
        order by m.at desc, m.id desc
        limit ${MOVE_PAGE} offset ${(current - 1) * MOVE_PAGE}`,
    ),
    rows<{ total: number }>(
      db,
      sql`select count(*)::int as total from stock_move m where ${where}`,
    ),
  ]);
  return { kind, rows: list, total: counted[0]?.total ?? 0, page: current, pageSize: MOVE_PAGE };
}

export async function overview(db: Database, me: Me): Promise<Overview> {
  const seesPurchases = may(me, COST_ROLES);
  const reviews = me.role === "management" || me.role === "admin";
  const seesApps = may(me, REPORT_ROLES);
  const [stock, purchases, review, activity, apps] = await Promise.all([
    listInventory(db, me),
    seesPurchases
      ? rows<{ purchases: number; pieces: number; late: number }>(
          db,
          // Purchase orders not yet on the shelf: Purchases' (Zoho's and those made here) and the
          // first purchase pages' few.
          sql`with today as (select (now() at time zone 'Asia/Manila')::date as d),
            open as (
              select pu.id as id, 'crm' as road, (select sum(l.qty) from purchase_line l where l.purchase_id = pu.id) as pieces, pu.expected_on as due
                from purchase pu where pu.state = 'ordered'
              union all
              select d.id, 'books', sum((l.qty - coalesce((l.qty_done->>'cancelled')::numeric, 0) - coalesce((l.qty_done->>'received')::numeric, 0))), min(d.due_date)
                from book_doc d join book_line l on l.doc_id = d.id, today t
                where d.kind = 'purchase_order' and d.status not in ('draft', 'cancelled', 'closed', 'void')
                  and l.medicine_id is not null and coalesce(d.due_date, d.doc_date) >= t.d - 365
                  and (l.qty - coalesce((l.qty_done->>'cancelled')::numeric, 0) - coalesce((l.qty_done->>'received')::numeric, 0)) > 0
                group by d.id
            )
            select count(*)::int as purchases, coalesce(sum(pieces), 0)::int as pieces,
              count(*) filter (where due < (select d from today))::int as late
            from open`,
        )
      : Promise.resolve([]),
    reviews
      ? rows<{ n: number }>(
          db,
          sql`select count(*)::int as n from customer where active and review = 'to_review'`,
        )
      : Promise.resolve([]),
    rows<MoveRow>(
      db,
      sql`select ${moveColumns}, null::text as "toWarehouse"
        from stock_move m ${moveJoins}
        where m.kind <> 'move_in'
        order by m.at desc, m.id desc limit 8`,
    ),
    seesApps
      ? rows<NonNullable<Overview["apps"]>>(
          db,
          sql`select (select count(*) from customer where active)::int as customers,
              (select count(*) from customer where active and review = 'to_review')::int as "toReview",
              (select count(*) from channel where active)::int as channels,
              (select count(*) from person where active)::int as people`,
        )
      : Promise.resolve([]),
  ]);

  const medicines = stock.medicines;
  return {
    today: stock.today,
    can: inventoryCan(me),
    stock: {
      ...stock.summary,
      expired: medicines.filter((medicine) => medicine.expired > 0).length,
    },
    toReceive: seesPurchases ? (purchases[0] ?? { purchases: 0, pieces: 0, late: 0 }) : null,
    toReview: reviews ? (review[0]?.n ?? 0) : null,
    topStocked: [...medicines]
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map(({ id, name, strength, unit, total, packSize }) => ({
        id,
        name,
        strength,
        unit,
        total,
        packSize,
      })),
    low: medicines
      .filter((medicine) => medicine.status !== "ok")
      .sort((a, b) => a.total - b.total)
      .slice(0, 6)
      .map(({ id, name, strength, unit, total, reorderLevel, status }) => ({
        id,
        name,
        strength,
        unit,
        total,
        reorderLevel,
        status,
      })),
    activity,
    apps: seesApps ? (apps[0] ?? null) : null,
  };
}

// ---------------------------------------------------------------- reports

/** Who sees the company's reports. A channel's own people get their channel's later. */
export const REPORT_ROLES: readonly Role[] = ["ceo", "admin"];

export async function channelReport(db: Database): Promise<ChannelReport> {
  const [channels, people, counts] = await Promise.all([
    rows<{
      id: number;
      code: string;
      name: string;
      headId: number | null;
      headName: string | null;
      headTitle: string | null;
    }>(
      db,
      sql`select ch.id::int as id, ch.code, ch.name, ch.head_id::int as "headId", h.name as "headName", h.title as "headTitle"
        from channel ch left join person h on h.id = ch.head_id and h.active
        where ch.active order by ch.sort, ch.id`,
    ),
    rows<{
      id: number;
      channelId: number;
      name: string;
      role: Role;
      title: string | null;
      area: string | null;
      reportsTo: number | null;
    }>(
      db,
      sql`select p.id::int as id, p.channel_id::int as "channelId", p.name, p.role, p.title,
          a.name as area, p.reports_to::int as "reportsTo"
        from person p left join area a on a.id = p.area_id
        where p.active and p.channel_id is not null
        order by p.name`,
    ),
    rows<{ channelId: number; areas: number; customers: number }>(
      db,
      sql`select a.channel_id::int as "channelId", count(distinct a.id)::int as areas,
          count(c.id) filter (where c.active)::int as customers
        from area a left join customer c on c.area_id = a.id
        group by a.channel_id`,
    ),
  ]);
  return {
    channels: channels.map((channel) => {
      const members = people.filter((person) => person.channelId === channel.id);
      const inChannel = new Set(members.map((person) => person.id));
      // Under each person, the channel's people who report to them. The named head stands
      // first at the top; anyone whose boss is outside the channel stands at the top too.
      const under = (bossId: number): ChannelPerson[] =>
        members
          .filter((person) => person.reportsTo === bossId)
          .map(({ id, name, role, title, area }) => ({
            id,
            name,
            roleLabel: ROLE_LABEL[role],
            title,
            area,
            team: under(id),
          }));
      const tops = members
        .filter((person) => person.reportsTo === null || !inChannel.has(person.reportsTo))
        .sort((a, b) => Number(b.id === channel.headId) - Number(a.id === channel.headId));
      const counted = counts.find((row) => row.channelId === channel.id);
      return {
        id: channel.id,
        code: channel.code,
        name: channel.name,
        head:
          channel.headId && channel.headName
            ? { id: channel.headId, name: channel.headName, title: channel.headTitle }
            : null,
        people: members.length,
        medreps: members.filter((person) => person.role === "medrep").length,
        tree: tops.map(({ id, name, role, title, area }) => ({
          id,
          name,
          roleLabel: ROLE_LABEL[role],
          title,
          area,
          team: under(id),
        })),
        areas: counted?.areas ?? 0,
        customers: counted?.customers ?? 0,
      };
    }),
  };
}

// ---------------------------------------------------------------- search

/** The top bar's search: medicines by name, molecule or SKU; customers the person may see. */
export async function search(db: Database, me: Me, text: string): Promise<SearchResult> {
  const q = text.trim().slice(0, 60);
  if (q.length < 2) return { medicines: [], customers: [], orders: [], people: [] };
  const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  // People: the CEO and the Admin anyone; a lead their own team; others nobody (by name or the
  // seat's login ID, "hos1").
  const whole = me.role === "ceo" || me.role === "admin";
  const lead = me.role === "team_lead" || me.role === "manager";
  const today = todayManila();
  const [orders, people] = await Promise.all([
    findOrders(db, me, like),
    whole || lead
      ? rows<SearchResult["people"][number]>(
          db,
          sql`with recursive team as (select id from person where id = ${me.id}
              union all select p.id from person p join team t on p.reports_to = t.id)
            select distinct on (p.id) p.id::int as id, p.name, p.title, s.login, s.id::int as "seatId", u.name as team
            from person p
              left join seat_holder h on h.person_id = p.id and h.kind = 'holder'
                and h.starts_on <= ${today}::date and (h.ends_on is null or h.ends_on >= ${today}::date)
              left join seat s on s.id = h.seat_id and s.active
              left join org_unit u on u.id = s.unit_id
            where p.active and (p.name ilike ${like} or s.login ilike ${like})
              ${whole ? sql`` : sql`and p.id in (select id from team)`}
            order by p.id, s.lead desc limit 6`,
        )
      : Promise.resolve([] as SearchResult["people"]),
  ]);
  const [medicines, customers] = await Promise.all([
    rows<SearchResult["medicines"][number]>(
      db,
      sql`select id::int as id, name, strength, sku from medicine
        where active and (name ilike ${like} or generic ilike ${like} or sku ilike ${like} or code ilike ${like})
        order by name limit 6`,
    ),
    listCustomers(db, me, { q, page: 1 }),
  ]);
  return {
    medicines,
    customers: customers.rows
      .slice(0, 6)
      .map(({ id, name, kind, city }) => ({ id, name, kind, city })),
    orders,
    people,
  };
}
