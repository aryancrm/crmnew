// Dispatch's work board, in the order the warehouse works: 1 Pack (what to pick, how many, by
// when, any note), 2 Ship (where it goes, to whom, what is in the box batch by batch, cash to
// collect), 3 On the road (with whom, since when, cash to collect), and what was delivered today.
// One card per order with only the facts its step needs; a few queries whatever the number.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow } from "../http";
import { todayManila } from "../inventory/rules";
import { day, iso } from "../inventory/service";
import type { DispatchBoard, DispatchCard, Me, PaperKind } from "../types";
import { DISPATCH_READ_ROLES, DISPATCH_ROLES } from "./rules";

const LANE_SIZE = 100;
/** How far back the Delivered list goes. */
const DONE_DAYS = 30;

export async function dispatchBoard(db: Database, me: Me): Promise<DispatchBoard> {
  allow(me, DISPATCH_READ_ROLES, "see Dispatch's work");
  const today = todayManila();
  const columns = sql`o.id::int as id, o.code, o.customer_id::int as "customerId", c.name as customer, c.kind as "customerKind",
    rep.name as medrep, coalesce(o.delivery_address, c.address, c.city) as address, o.receiver, o.receiver_phone as "receiverPhone",
    ${day("o.expected_on")} as "expectedOn", w.name as warehouse, o.note, o.status,
    (select coalesce(sum(i.qty), 0) from order_item i where i.order_id = o.id)::int as pieces,
    o.delivery_method as method, o.courier, o.tracking, o.rider, ${iso("o.shipped_at")} as "shippedAt",
    ${iso("o.status_since")} as "stepSince", (select p.name from person p where p.id = o.dispatch_by) as "dispatchBy",
    o.dispatch_by::int as "dispatchById", o.came_back_count::int as "cameBackCount", o.came_back_reason as "cameBackReason",
    (o.status = 'packing' and o.came_back_at is not null) as "cameBack", o.received_by as "receivedBy",
    ${iso("o.delivered_at")} as "deliveredAt",
    -- Cash the courier or rider collects: an open cash-on-delivery invoice's balance.
    (select (i.total - i.paid)::int from invoice i where i.order_id = o.id and i.status = 'open' and i.terms = 'cod'
      and i.total > i.paid limit 1) as collect,
    -- How it is paid (Aryan, 19 Nov: Dispatch sees which are COD, prepaid or on terms): the invoice as it stands.
    (select json_build_object('terms', i.terms, 'days', o.payment_days, 'payBy', to_char(o.pay_by, 'YYYY-MM-DD'),
        'total', i.total, 'balance', i.total - i.paid, 'paid', i.status = 'paid', 'dueOn', to_char(i.due_on, 'YYYY-MM-DD'))
      from invoice i where i.order_id = o.id and i.status <> 'cancelled' order by i.id desc limit 1) as pay,
    -- The cash on delivery Dispatch noted: how much and who has it.
    case when o.cod_collected is not null then json_build_object('amount', o.cod_collected, 'by', o.cod_collected_by,
      'on', to_char(o.cod_noted_at at time zone 'Asia/Manila', 'YYYY-MM-DD')) end as cod`;
  const from = sql`from sales_order o join customer c on c.id = o.customer_id join person rep on rep.id = o.medrep_id
    left join warehouse w on w.id = o.warehouse_id`;
  const lane = (where: SQL, order: SQL) =>
    rows<Omit<DispatchCard, "items" | "picks" | "papers">>(
      db,
      sql`select ${columns} ${from} where ${where} order by ${order} limit ${LANE_SIZE}`,
    );
  const [toPack, toShip, road, delivered, done, counted] = await Promise.all([
    // Late and wanted first, then the longest waiting.
    lane(
      sql`o.status = 'ready_for_dispatch'`,
      sql`(o.expected_on is not null and o.expected_on <= ${today}::date) desc, o.expected_on nulls last, o.status_since, o.id`,
    ),
    // What came back goes out again first.
    lane(sql`o.status = 'packing'`, sql`(o.came_back_at is not null) desc, o.status_since, o.id`),
    lane(sql`o.status = 'shipped'`, sql`o.shipped_at, o.id`),
    lane(
      sql`o.status = 'completed' and o.delivered_on = ${today}::date`,
      sql`o.delivered_at desc nulls last, o.id desc`,
    ),
    // Delivered over the last 30 days, the newest first: each with how it is paid.
    lane(
      sql`o.status = 'completed' and o.delivered_on >= ${today}::date - ${DONE_DAYS}::int`,
      sql`o.delivered_on desc, o.delivered_at desc nulls last, o.id desc`,
    ),
    rows<DispatchBoard["counts"]>(
      db,
      sql`select count(*) filter (where o.status = 'ready_for_dispatch')::int as "toPack",
          count(*) filter (where o.status = 'packing')::int as "toShip",
          count(*) filter (where o.status = 'shipped')::int as road,
          count(*) filter (where o.status = 'completed' and o.delivered_on = ${today}::date)::int as delivered,
          count(*) filter (where o.status = 'completed' and o.delivered_on >= ${today}::date - ${DONE_DAYS}::int)::int as done,
          count(*) filter (where o.status in ('on_hold', 'exception')
            and (o.held_role = 'dispatch' or o.held_from in ('ready_for_dispatch', 'packing', 'shipped')))::int as held,
          count(*) filter (where o.status in ('finance_check', 'ready_for_invoice'))::int as coming
        from sales_order o where o.status not in ('draft', 'cancelled')`,
    ),
  ]);
  const all = [...toPack, ...toShip, ...road, ...delivered, ...done];
  const ids = all.map((card) => card.id);
  const list = ids.length
    ? sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )
    : sql`0`;
  const [items, picks, papers] = await Promise.all([
    rows<DispatchCard["items"][number] & { orderId: number }>(
      db,
      sql`select i.order_id::int as "orderId", m.name || coalesce(' ' || m.strength, '') as name, i.qty::int as qty,
          m.pack_size::int as "packSize", m.unit, i.free, m.cold_chain as cold
        from order_item i join medicine m on m.id = i.medicine_id where i.order_id in (${list}) order by i.id`,
    ),
    rows<DispatchCard["picks"][number] & { orderId: number }>(
      db,
      sql`select p.order_id::int as "orderId", m.name || coalesce(' ' || m.strength, '') as medicine, b.batch_no as "batchNo",
          ${day("b.expires_on")} as "expiresOn", p.qty::int as qty
        from order_pick p join batch b on b.id = p.batch_id join medicine m on m.id = b.medicine_id
        where p.active and p.order_id in (${list}) order by p.order_item_id, b.expires_on, p.id`,
    ),
    rows<{ orderId: number; kind: PaperKind }>(
      db,
      sql`select distinct order_id::int as "orderId", kind from order_file where active and order_id in (${list})`,
    ),
  ]);
  const card = (row: Omit<DispatchCard, "items" | "picks" | "papers">): DispatchCard => ({
    ...row,
    items: items.filter((item) => item.orderId === row.id).map(({ orderId: _o, ...item }) => item),
    picks: picks.filter((pick) => pick.orderId === row.id).map(({ orderId: _o, ...pick }) => pick),
    papers: papers.filter((paper) => paper.orderId === row.id).map((paper) => paper.kind),
  });
  return {
    today,
    counts: counted[0] ?? { toPack: 0, toShip: 0, road: 0, delivered: 0, done: 0, held: 0, coming: 0 },
    toPack: toPack.map(card),
    toShip: toShip.map(card),
    road: road.map(card),
    delivered: delivered.map(card),
    done: done.map(card),
    doneDays: DONE_DAYS,
    can: { work: DISPATCH_ROLES.includes(me.role) },
  };
}
