// A team lead's (or a head's) team, read from the seats under them in the company's tree: every
// seat, filled or empty, with this month's sales against its holder's target, where its open
// orders stand and how long the oldest has waited, what its customers owe; and the things that
// need the lead now (sent back, on hold, late at a step, overdue, an empty seat's customers). A
// head sees every team under them; the CEO and the Admin any box of the tree. Orders count for
// the seat they were sold from, so an area keeps its history when its MedRep changes.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { day, iso } from "../inventory/service";
import { lateNow } from "../orders/clock";
import { STATUS_LABEL } from "../orders/rules";
import { inForce, ledUnits } from "../org/service";
import { ROLE_LABEL, type Role } from "../people/roles";
import type { Me, OrderStatus, OrgUnitKind, TeamBoard, TeamNeed, TeamSeatCard } from "../types";

const LEADS: Role[] = ["team_lead", "manager"];
const WHOLE: Role[] = ["ceo", "admin"];

const OPEN = sql`o.status in ('pending_approval', 'finance_check', 'ready_for_invoice', 'ready_for_dispatch', 'packing', 'shipped')`;

const ids = (values: number[]): SQL =>
  values.length
    ? sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
      )
    : sql`0`;

/** "6h", "2d": how long since a moment. */
function waited(since: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(since)) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const HELD_BY: Record<string, string> = {
  management: "Management",
  finance: "Finance",
  dispatch: "Dispatch",
};

const STEP_WORD: Partial<Record<OrderStatus, string>> = {
  pending_approval: "At Management",
  finance_check: "With Finance",
  ready_for_invoice: "Waiting for its invoice",
  ready_for_dispatch: "Waiting to be packed",
  packing: "Packed, not shipped",
  shipped: "On the road",
};

/** The seats and boxes a person's team view covers, and its top boxes. The CEO and the Admin see
 *  the whole company or any box and what is under it; a team lead (a head too) the boxes they lead
 *  (or cover) and those under, or one of them; anyone else nothing. */
async function viewOf(
  db: Database,
  me: Me,
  unitId: number | null,
): Promise<{ seatIds: number[]; unitIds: number[]; rootIds: number[] }> {
  const subtree = async (top: number[]) =>
    top.length
      ? (
          await rows<{ id: number }>(
            db,
            sql`with recursive down as (select id from org_unit where id in (${ids(top)}) and active
                union all select u.id from org_unit u join down on u.parent_id = down.id where u.active)
              select distinct id::int as id from down`,
          )
        ).map((row) => row.id)
      : [];
  const seatsIn = async (unitIds: number[], extra: SQL = sql`false`) =>
    (
      await rows<{ id: number }>(
        db,
        sql`select s.id::int as id from seat s where s.active and (s.unit_id in (${ids(unitIds)}) or ${extra})`,
      )
    ).map((row) => row.id);
  if (WHOLE.includes(me.role)) {
    const [company] = await rows<{ id: number }>(
      db,
      sql`select id::int as id from org_unit where kind = 'company' and active`,
    );
    const root = unitId ?? company?.id ?? 0;
    const unitIds = await subtree([root]);
    // The company's own CEO and Admin seats are left out of its figures.
    const seatIds = unitId
      ? await seatsIn(unitIds)
      : (
          await rows<{ id: number }>(
            db,
            sql`select s.id::int as id from seat s where s.active and s.module not in ('ceo', 'admin')`,
          )
        ).map((row) => row.id);
    return { seatIds, unitIds, rootIds: [root] };
  }
  if (!LEADS.includes(me.role))
    throw new Refusal(403, "not_allowed", "My team is for team leads and heads.");
  const led = await ledUnits(db, me);
  if (unitId) {
    if (!led.includes(unitId)) throw new Refusal(403, "not_allowed", "That team isn't under you.");
    const unitIds = await subtree([unitId]);
    return { seatIds: await seatsIn(unitIds), unitIds, rootIds: [unitId] };
  }
  // Their own boxes, plus any seat that reports to them from elsewhere.
  const seatIds = await seatsIn(
    led,
    sql`s.boss_id in (with recursive team as (select id from person where id = ${me.id}
        union all select p.id from person p join team t on p.reports_to = t.id) select id from team)
      or s.id in (select h.seat_id from seat_holder h where h.person_id = ${me.id} and ${inForce("h", todayManila())})`,
  );
  const parents = await rows<{ id: number; parentId: number | null }>(
    db,
    sql`select id::int as id, parent_id::int as "parentId" from org_unit where id in (${ids(led)})`,
  );
  const inLed = new Set(led);
  return {
    seatIds,
    unitIds: led,
    rootIds: parents
      .filter((unit) => unit.parentId === null || !inLed.has(unit.parentId))
      .map((unit) => unit.id),
  };
}

/** The days asked for, checked: this month so far unless picked; at most a year. */
function rangeOf(asked: { from?: string | null; to?: string | null }, today: string) {
  const isDay = (value?: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
  const from = isDay(asked.from) ? (asked.from as string) : `${today.slice(0, 7)}-01`;
  const to = isDay(asked.to) ? (asked.to as string) : today;
  if (from > to)
    throw new Refusal(400, "invalid", "The first day comes after the last one.", "from");
  const days =
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > 366) throw new Refusal(400, "invalid", "Pick at most a year.", "from");
  return { from, to, days };
}

const dayList = (from: string, days: number) =>
  Array.from({ length: days }, (_, n) =>
    new Date(Date.parse(`${from}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10),
  );

/** A monthly target shared out over the days of the range that fall in its month. */
function prorated(
  targets: { month: string; amount: number }[],
  from: string,
  to: string,
): number | null {
  if (!targets.length) return null;
  let total = 0;
  for (const { month, amount } of targets) {
    const [y, m] = month.split("-").map(Number) as [number, number];
    const inMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const first = `${month.slice(0, 7)}-01`;
    const last = `${month.slice(0, 7)}-${String(inMonth).padStart(2, "0")}`;
    const start = from > first ? from : first;
    const end = to < last ? to : last;
    if (start > end) continue;
    const days =
      Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) +
      1;
    total += (amount * days) / inMonth;
  }
  return Math.round(total);
}

const STEP_OF = sql`case when st.status = 'pending_approval' then 'management'
  when st.status in ('finance_check', 'ready_for_invoice') then 'finance'
  when st.status in ('ready_for_dispatch', 'packing') then 'dispatch'
  when st.status = 'shipped' then 'road' end`;

export async function teamBoard(
  db: Database,
  me: Me,
  asked: { unitId?: number | null; from?: string | null; to?: string | null } = {},
): Promise<TeamBoard> {
  const today = todayManila();
  const { from, to, days } = rangeOf(asked, today);
  const view = await viewOf(db, me, asked.unitId ?? null);
  const { seatIds } = view;
  const list = ids(seatIds);
  const placedDay = sql`(coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Manila')::date`;
  const inRange = (column: SQL) => sql`${column} between ${from}::date and ${to}::date`;
  // Cash on delivery isn't owed until the goods arrive.
  const due = sql`not (i.terms in ('cod', 'days') and o.status <> 'completed')`;

  const [
    seats,
    now,
    oldest,
    owed,
    sold,
    collected,
    placed,
    other,
    mine,
    units,
    medicines,
    kinds,
    steps,
  ] = await Promise.all([
    rows<{
      seatId: number;
      login: string | null;
      unitId: number;
      title: string;
      module: Role;
      lead: boolean;
      areaName: string | null;
      cities: string[] | null;
      personId: number | null;
      name: string | null;
      phone: string | null;
      email: string | null;
      since: string | null;
      actingName: string | null;
      actingUntil: string | null;
      customers: number;
    }>(
      db,
      sql`select s.id::int as "seatId", s.login, s.unit_id::int as "unitId", s.title, s.module, s.lead,
            a.name as "areaName", a.cities, p.id::int as "personId", p.name, p.phone, p.email, ${day("h.starts_on")} as since,
            ap.name as "actingName", ${day("ah.ends_on")} as "actingUntil",
            (select count(*) from customer c where c.active and s.area_id is not null and c.area_id = s.area_id)::int as customers
          from seat s left join area a on a.id = s.area_id
            left join lateral (select x.person_id, x.starts_on from seat_holder x join person q on q.id = x.person_id and q.active
              where x.seat_id = s.id and x.kind = 'holder' and ${inForce("x", today)} order by x.starts_on desc, x.id desc limit 1) h on true
            left join person p on p.id = h.person_id
            left join lateral (select x.person_id, x.ends_on from seat_holder x join person q on q.id = x.person_id and q.active
              where x.seat_id = s.id and x.kind = 'acting' and ${inForce("x", today)} order by x.starts_on desc limit 1) ah on true
            left join person ap on ap.id = ah.person_id
          where s.id in (${list})
          order by s.lead desc, s.sort, s.id`,
    ),
    rows<TeamSeatCard["stages"] & { seatId: number; lastOrderAt: string | null }>(
      db,
      sql`select o.seat_id::int as "seatId",
            count(*) filter (where o.status = 'pending_approval')::int as management,
            count(*) filter (where o.status in ('finance_check', 'ready_for_invoice'))::int as finance,
            count(*) filter (where o.status in ('ready_for_dispatch', 'packing'))::int as dispatch,
            count(*) filter (where o.status = 'shipped')::int as road,
            count(*) filter (where o.status in ('on_hold', 'exception'))::int as held,
            count(*) filter (where o.status = 'draft' and o.sent_back_at is not null)::int as "sentBack",
            ${iso("(max(coalesce(o.submitted_at, o.created_at)) filter (where o.status <> 'draft'))")} as "lastOrderAt"
          from sales_order o where o.seat_id in (${list}) group by o.seat_id`,
    ),
    rows<{ seatId: number; status: OrderStatus; since: string }>(
      db,
      sql`select distinct on (o.seat_id) o.seat_id::int as "seatId", o.status, ${iso("o.status_since")} as since
          from sales_order o where o.seat_id in (${list})
            and (${OPEN} or o.status in ('on_hold', 'exception') or (o.status = 'draft' and o.sent_back_at is not null))
          order by o.seat_id, o.status_since, o.id`,
    ),
    rows<{ seatId: number; owed: number; overdue: number }>(
      db,
      sql`select o.seat_id::int as "seatId",
            coalesce(sum(i.total - i.paid) filter (where i.status = 'open' and not (i.terms = 'cod' and o.status <> 'completed')), 0)::float8 as owed,
            coalesce(sum(i.total - i.paid) filter (where i.status = 'open' and ${due} and i.due_on < ${today}::date), 0)::float8 as overdue
          from invoice i join sales_order o on o.id = i.order_id where o.seat_id in (${list}) group by o.seat_id`,
    ),
    rows<{ seatId: number; day: string; amount: number }>(
      db,
      sql`select o.seat_id::int as "seatId", ${day("i.issued_on")} as day, sum(i.total)::float8 as amount
          from invoice i join sales_order o on o.id = i.order_id
          where o.seat_id in (${list}) and i.status <> 'cancelled' and ${inRange(sql`i.issued_on`)} group by 1, 2`,
    ),
    rows<{ seatId: number; day: string; amount: number }>(
      db,
      sql`select o.seat_id::int as "seatId", ${day("p.paid_on")} as day, sum(p.amount)::float8 as amount
          from payment p join invoice i on i.id = p.invoice_id join sales_order o on o.id = i.order_id
          where o.seat_id in (${list}) and p.active and p.method <> 'points' and ${inRange(sql`p.paid_on`)} group by 1, 2`,
    ),
    rows<{ seatId: number; day: string; count: number; amount: number }>(
      db,
      sql`select o.seat_id::int as "seatId", to_char(${placedDay}, 'YYYY-MM-DD') as day, count(*)::int as count,
            sum(o.total)::float8 as amount
          from sales_order o where o.seat_id in (${list}) and o.status not in ('draft', 'cancelled') and ${inRange(placedDay)}
          group by 1, 2`,
    ),
    rows<{ seatId: number; delivered: number; newCustomers: number }>(
      db,
      sql`select s.id::int as "seatId",
            (select count(*) from sales_order o where o.seat_id = s.id and o.status = 'completed'
              and ${inRange(sql`o.delivered_on`)})::int as delivered,
            (select count(*) from customer c where s.area_id is not null and c.area_id = s.area_id
              and ${inRange(sql`(c.created_at at time zone 'Asia/Manila')::date`)})::int as "newCustomers"
          from seat s where s.id in (${list})`,
    ),
    rows<{
      name: string;
      title: string | null;
      seat: string;
      unit: string;
      kind: "holder" | "acting";
      lead: boolean;
    }>(
      db,
      sql`select p.name, p.title, s.title as seat, u.name as unit, h.kind, s.lead
          from person p left join seat_holder h on h.person_id = p.id and ${inForce("h", today)}
            left join seat s on s.id = h.seat_id and s.active left join org_unit u on u.id = s.unit_id
          where p.id = ${me.id} order by h.kind, h.starts_on`,
    ),
    rows<{
      id: number;
      name: string;
      kind: OrgUnitKind;
      parentId: number | null;
      leadSeatId: number | null;
    }>(
      db,
      sql`select u.id::int as id, u.name, u.kind, u.parent_id::int as "parentId",
            (select s.id::int from seat s where s.unit_id = u.id and s.active and s.lead order by s.sort, s.id limit 1) as "leadSeatId"
          from org_unit u where u.active order by u.sort, u.id`,
    ),
    rows<TeamBoard["topMedicines"][number]>(
      db,
      sql`select m.name || coalesce(' ' || m.strength, '') as name, sum(i.qty)::int as qty,
            sum(i.qty * i.unit_price)::float8 as value
          from order_item i join sales_order o on o.id = i.order_id join medicine m on m.id = i.medicine_id
          where o.seat_id in (${list}) and o.status not in ('draft', 'cancelled') and ${inRange(placedDay)}
          group by 1 order by value desc, qty desc limit 8`,
    ),
    rows<TeamBoard["byKind"][number]>(
      db,
      sql`select c.kind, count(distinct c.id)::int as customers,
            count(distinct o.id) filter (where o.id is not null)::int as orders, coalesce(sum(o.total), 0)::float8 as value
          from customer c join seat s on s.area_id = c.area_id and s.id in (${list})
            left join sales_order o on o.customer_id = c.id and o.status not in ('draft', 'cancelled') and ${inRange(placedDay)}
          where c.active group by c.kind order by customers desc`,
    ),
    rows<{ step: TeamBoard["stepTimes"][number]["step"]; minutes: number; orders: number }>(
      db,
      sql`select ${STEP_OF} as step, avg(extract(epoch from st.left_at - st.entered_at) / 60)::float8 as minutes,
            count(distinct st.order_id)::int as orders
          from order_step st join sales_order o on o.id = st.order_id
          where o.seat_id in (${list}) and st.left_at is not null
            and ${inRange(sql`(st.left_at at time zone 'Asia/Manila')::date`)} and ${STEP_OF} is not null
          group by 1`,
    ),
  ]);
  const holders = seats.flatMap((seat) => (seat.personId ? [seat.personId] : []));
  const [targets, needs] = await Promise.all([
    rows<{ personId: number; month: string; amount: number }>(
      db,
      sql`select person_id::int as "personId", ${day("month")} as month, amount::float8 as amount from sales_target
        where month between date_trunc('month', ${from}::date) and date_trunc('month', ${to}::date)
          and person_id in (${ids(holders)})`,
    ),
    teamNeeds(db, seatIds, today),
  ]);

  const dayNames = dayList(from, days);
  const sumOf = <T extends { seatId: number }>(
    found: T[],
    seatId: number,
    pick: (row: T) => number,
  ) => found.filter((row) => row.seatId === seatId).reduce((total, row) => total + pick(row), 0);
  const cards: TeamSeatCard[] = seats.map((seat) => {
    const n = now.find((row) => row.seatId === seat.seatId);
    const o = other.find((row) => row.seatId === seat.seatId);
    const m = owed.find((row) => row.seatId === seat.seatId);
    const old = oldest.find((row) => row.seatId === seat.seatId);
    const soldDays = new Map(
      sold.filter((row) => row.seatId === seat.seatId).map((row) => [row.day, row.amount]),
    );
    return {
      seatId: seat.seatId,
      login: seat.login,
      unitId: seat.unitId,
      title: seat.title,
      moduleLabel: ROLE_LABEL[seat.module] ?? seat.module,
      lead: seat.lead,
      area: seat.areaName ? { name: seat.areaName, cities: seat.cities ?? [] } : null,
      person: seat.personId
        ? {
            id: seat.personId,
            name: seat.name ?? "",
            phone: seat.phone,
            email: seat.email,
            since: seat.since ?? "",
          }
        : null,
      acting: seat.actingName ? { name: seat.actingName, until: seat.actingUntil } : null,
      target: seat.personId
        ? prorated(
            targets.filter((row) => row.personId === seat.personId),
            from,
            to,
          )
        : null,
      sold: sumOf(sold, seat.seatId, (row) => row.amount),
      today: soldDays.get(today) ?? 0,
      collected: sumOf(collected, seat.seatId, (row) => row.amount),
      placed: sumOf(placed, seat.seatId, (row) => row.count),
      placedValue: sumOf(placed, seat.seatId, (row) => row.amount),
      delivered: o?.delivered ?? 0,
      newCustomers: o?.newCustomers ?? 0,
      spark: dayNames.map((name) => soldDays.get(name) ?? 0),
      stages: {
        management: n?.management ?? 0,
        finance: n?.finance ?? 0,
        dispatch: n?.dispatch ?? 0,
        road: n?.road ?? 0,
        held: n?.held ?? 0,
        sentBack: n?.sentBack ?? 0,
      },
      oldest: old ? { status: old.status, since: old.since } : null,
      owed: m?.owed ?? 0,
      overdue: m?.overdue ?? 0,
      customers: seat.customers,
      lastOrderAt: n?.lastOrderAt ?? null,
    };
  });

  // The boxes in view (with seats or with boxes under them that have), in the tree's reading
  // order; and the line from the top box down to the one looked at.
  const used = new Set([...cards.map((card) => card.unitId), ...view.unitIds]);
  const ordered: TeamBoard["units"] = [];
  const walk = (parentId: number | null) => {
    for (const unit of units.filter((one) => one.parentId === parentId)) {
      if (used.has(unit.id)) ordered.push(unit);
      walk(unit.id);
    }
  };
  walk(null);
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const path: TeamBoard["path"] = [];
  if (view.rootIds.length === 1) {
    const top = WHOLE.includes(me.role) ? null : new Set(await ledUnits(db, me));
    for (
      let at = byId.get(view.rootIds[0] as number);
      at;
      at = at.parentId ? byId.get(at.parentId) : undefined
    ) {
      path.unshift({ id: at.id, name: at.name });
      // A lead's line starts at the top box they lead.
      if (top && (!at.parentId || !top.has(at.parentId))) break;
    }
  }

  const total = (pick: (card: TeamSeatCard) => number) =>
    cards.reduce((sum, card) => sum + pick(card), 0);
  const withTarget = cards.filter((card) => card.target !== null);
  const stage = (key: keyof TeamSeatCard["stages"]) => total((card) => card.stages[key]);
  const byDay = (found: { day: string; amount: number }[]) => {
    const map = new Map<string, number>();
    for (const row of found) map.set(row.day, (map.get(row.day) ?? 0) + row.amount);
    return map;
  };
  const soldBy = byDay(sold);
  const placedBy = byDay(placed);
  const collectedBy = byDay(collected);
  const elapsed = today < from ? 0 : today >= to ? days : dayList(from, days).indexOf(today) + 1;
  return {
    today,
    from,
    to,
    days,
    pace: days ? elapsed / days : 1,
    lead: {
      name: mine[0]?.name ?? me.name,
      title: mine[0]?.title ?? me.title,
      units: mine.filter((row) => row.kind === "holder" && row.lead).map((row) => row.unit),
      covering: mine
        .filter((row) => row.kind === "acting")
        .map((row) => `${row.seat} · ${row.unit}`),
    },
    viewing:
      view.rootIds.length === 1 && (asked.unitId || WHOLE.includes(me.role))
        ? (byId.get(view.rootIds[0] as number)?.name ?? null)
        : null,
    rootIds: view.rootIds,
    path,
    units: ordered,
    seats: cards,
    needs,
    totals: {
      target: withTarget.length
        ? withTarget.reduce((sum, card) => sum + (card.target ?? 0), 0)
        : null,
      sold: total((card) => card.sold),
      today: total((card) => card.today),
      collected: total((card) => card.collected),
      placed: total((card) => card.placed),
      placedValue: total((card) => card.placedValue),
      delivered: total((card) => card.delivered),
      newCustomers: total((card) => card.newCustomers),
      waiting: stage("management") + stage("finance") + stage("dispatch") + stage("road"),
      stopped: stage("held") + stage("sentBack"),
      owed: total((card) => card.owed),
      overdue: total((card) => card.overdue),
      vacant: cards.filter((card) => !card.person).length,
      people: new Set(cards.flatMap((card) => (card.person ? [card.person.id] : []))).size,
    },
    stagesNow: {
      management: stage("management"),
      finance: stage("finance"),
      dispatch: stage("dispatch"),
      road: stage("road"),
      held: stage("held"),
      sentBack: stage("sentBack"),
    },
    daily: dayNames.map((name) => ({
      day: name,
      sold: soldBy.get(name) ?? 0,
      placed: placedBy.get(name) ?? 0,
      collected: collectedBy.get(name) ?? 0,
    })),
    topMedicines: medicines,
    byKind: kinds,
    stepTimes: steps,
  };
}

/** What needs the lead now: sent back, on hold, late at a step, overdue, empty seats. */
async function teamNeeds(db: Database, seatIds: number[], today: string): Promise<TeamNeed[]> {
  if (!seatIds.length) return [];
  const list = ids(seatIds);
  const who = sql`coalesce(rep.name, s.title || coalesce(' · ' || a.name, ''))`;
  const [orders, overdue, empty] = await Promise.all([
    rows<{
      orderId: number;
      code: string;
      customer: string;
      customerId: number;
      who: string;
      seatId: number;
      status: OrderStatus;
      reason: string | null;
      heldBy: string | null;
      since: string;
      amount: number;
    }>(
      db,
      sql`select o.id::int as "orderId", o.code, c.name as customer, c.id::int as "customerId", ${who} as who,
          o.seat_id::int as "seatId", o.status, coalesce(o.sent_back_reason, o.flag_reason) as reason, o.held_role as "heldBy",
          ${iso("(case when o.status = 'draft' then o.sent_back_at else o.status_since end)")} as since, o.total::float8 as amount
        from sales_order o join customer c on c.id = o.customer_id join seat s on s.id = o.seat_id
          left join area a on a.id = s.area_id
          left join lateral (select q.name from seat_holder h join person q on q.id = h.person_id and q.active
            where h.seat_id = s.id and h.kind = 'holder' and ${inForce("h", today)} order by h.starts_on desc, h.id desc limit 1) rep on true
        where o.seat_id in (${list}) and (
          (o.status = 'draft' and o.sent_back_at is not null)
          or o.status in ('on_hold', 'exception')
          or (${OPEN} and ${lateNow()}))
        order by (o.status = 'draft') desc, (o.status in ('on_hold', 'exception')) desc, o.status_since limit 40`,
    ),
    rows<{
      orderId: number;
      code: string;
      customer: string;
      customerId: number;
      who: string;
      seatId: number;
      balance: number;
      dueOn: string;
      daysLate: number;
    }>(
      db,
      sql`select o.id::int as "orderId", i.code, c.name as customer, c.id::int as "customerId", ${who} as who,
          o.seat_id::int as "seatId", (i.total - i.paid)::float8 as balance, ${day("i.due_on")} as "dueOn",
          (${today}::date - i.due_on)::int as "daysLate"
        from invoice i join sales_order o on o.id = i.order_id join customer c on c.id = i.customer_id
          join seat s on s.id = o.seat_id left join area a on a.id = s.area_id
          left join lateral (select q.name from seat_holder h join person q on q.id = h.person_id and q.active
            where h.seat_id = s.id and h.kind = 'holder' and ${inForce("h", today)} order by h.starts_on desc, h.id desc limit 1) rep on true
        where o.seat_id in (${list}) and i.status = 'open' and i.total > i.paid and i.due_on < ${today}::date
          and not (i.terms in ('cod', 'days') and o.status <> 'completed')
        order by i.due_on, i.id limit 20`,
    ),
    rows<{
      seatId: number;
      title: string;
      area: string | null;
      customers: number;
      open: number;
      acting: string | null;
    }>(
      db,
      sql`select s.id::int as "seatId", s.title, a.name as area,
          (select count(*) from customer c where c.active and s.area_id is not null and c.area_id = s.area_id)::int as customers,
          (select count(*) from sales_order o where o.seat_id = s.id and o.status not in ('completed', 'cancelled', 'draft'))::int as open,
          (select q.name from seat_holder h join person q on q.id = h.person_id and q.active
            where h.seat_id = s.id and h.kind = 'acting' and ${inForce("h", today)} limit 1) as acting
        from seat s left join area a on a.id = s.area_id
        where s.id in (${list}) and not exists (select 1 from seat_holder h join person q on q.id = h.person_id and q.active
          where h.seat_id = s.id and h.kind = 'holder' and ${inForce("h", today)})
        order by s.sort, s.id`,
    ),
  ]);
  const needs: TeamNeed[] = orders.map((row) => {
    const kind: TeamNeed["kind"] =
      row.status === "draft"
        ? "sent_back"
        : row.status === "on_hold" || row.status === "exception"
          ? "held"
          : "late";
    // Whose step it is, so the lead knows they chase it, they don't decide it.
    const desk = HELD_BY[row.heldBy ?? "management"] ?? "Management";
    const why =
      kind === "sent_back"
        ? `Management sent it back to ${row.who}${row.reason ? `: ${row.reason}` : ""}`
        : kind === "held"
          ? `${desk} put it on hold${row.reason ? `: ${row.reason}` : ""}`
          : `${STEP_WORD[row.status] ?? STATUS_LABEL[row.status]} for ${waited(row.since)}`;
    return {
      kind,
      orderId: row.orderId,
      code: row.code,
      customer: row.customer,
      customerId: row.customerId,
      who: row.who,
      seatId: row.seatId,
      why,
      since: row.since,
      amount: row.amount,
    };
  });
  for (const row of overdue)
    needs.push({
      kind: "overdue",
      orderId: row.orderId,
      code: row.code,
      customer: row.customer,
      customerId: row.customerId,
      who: row.who,
      seatId: row.seatId,
      why: `Payment ${row.daysLate} day${row.daysLate === 1 ? "" : "s"} late`,
      since: `${row.dueOn}T00:00:00+08:00`,
      amount: row.balance,
    });
  for (const row of empty)
    if (row.customers > 0 || row.open > 0)
      needs.push({
        kind: "vacant",
        orderId: null,
        code: null,
        customer: null,
        customerId: null,
        who: `${row.title}${row.area ? ` · ${row.area}` : ""}`,
        seatId: row.seatId,
        why: row.acting
          ? `Nobody sits here; ${row.acting} covers it. ${row.customers} customer${row.customers === 1 ? "" : "s"}, ${row.open} open order${row.open === 1 ? "" : "s"}.`
          : `Nobody sits here: ${row.customers} customer${row.customers === 1 ? "" : "s"} and ${row.open} open order${row.open === 1 ? "" : "s"} wait with you.`,
        since: null,
        amount: null,
      });
  return needs;
}

/** The seats a person's team view covers (for the scorecards). */
export const teamSeats = viewOf;
