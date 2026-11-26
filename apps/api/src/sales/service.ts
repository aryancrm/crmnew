// Sales against target, read one way for every page. A sale is an invoice Finance made (not
// cancelled), on the Manila day it was made, counted for the order's MedRep and its channel:
// what Zoho's "Sales by salesperson" and the CEO's sheet count. The team pages, the channel
// report, the CEO Home and the company tree all read these functions.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { stuckNow } from "../orders/clock";
import { STATUS_LABEL } from "../orders/rules";
import { creditedTo, inForce } from "../org/service";
import { ROLE_LABEL, type Role } from "../people/roles";
import type {
  CeoAlert,
  CeoHome,
  ChannelFigures,
  ChannelSalesDetail,
  CompanyTreeData,
  Me,
  MonthFacts,
  OrderStatus,
  SellerFigures,
  TeamSales,
} from "../types";
import {
  boundsOf,
  monthBounds,
  monthFacts,
  paceTone,
  pctOf,
  periodBefore,
  periodFacts,
} from "./rules";
import { companyNow } from "../companies/context";

const SELLERS: readonly Role[] = ["medrep", "team_lead", "manager", "online"];
const WHOLE: readonly Role[] = ["ceo", "admin"];
const LEADS: readonly Role[] = ["team_lead", "manager"];
const ids = (values: number[]) =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
const list = (values: readonly string[]) =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );

/** Invoices (alias `i`) that count as sold in a month. */
/** Every sale (the CRM's and Zoho's invoices) with its order's seat, MedRep, channel and id as "o". */
const saleAs = sql`sale_invoice i cross join lateral (select i.seat_id, i.medrep_id, i.covered, i.cover_lead_id, i.channel_id, coalesce(i.order_id, -i.id) as id) o`;

const soldIn = (facts: MonthFacts): SQL => {
  const { first, next } = boundsOf(facts);
  return sql`i.status <> 'cancelled' and i.issued_on >= ${first}::date and i.issued_on < ${next}::date`;
};

type Figures = {
  sold: number;
  today: number;
  placed: number;
  placedValue: number;
  waiting: number;
  held: number;
  target: number | null;
};
const NOTHING: Figures = {
  sold: 0,
  today: 0,
  placed: 0,
  placedValue: 0,
  waiting: 0,
  held: 0,
  target: null,
};

/** Each person's month, by the orders that name them as MedRep. */
async function figuresOf(
  db: Database,
  personIds: number[],
  facts: MonthFacts,
): Promise<Map<number, Figures>> {
  if (personIds.length === 0) return new Map();
  const { first, next } = monthBounds(facts.month);
  // Whose each order is: its seat's holder today (as My team counts), else its MedRep.
  const whose = creditedTo(todayManila());
  const [sold, placed, now, targets] = await Promise.all([
    rows<{ id: number; sold: number; today: number }>(
      db,
      sql`select ${whose}::int as id, sum(i.total)::float8 as sold,
          coalesce(sum(i.total) filter (where i.issued_on = ${facts.today}::date), 0)::float8 as today
        from sale_invoice i cross join lateral (select i.seat_id, i.medrep_id, i.covered, i.cover_lead_id) o
        where ${soldIn(facts)} and ${whose} in (${ids(personIds)}) group by 1`,
    ),
    rows<{ id: number; placed: number; value: number }>(
      db,
      sql`select ${whose}::int as id, count(*)::int as placed, sum(o.total)::float8 as value from sales_order o
        where o.status not in ('draft', 'cancelled') and ${whose} in (${ids(personIds)})
          and (coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Manila')::date >= ${first}::date
          and (coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Manila')::date < ${next}::date
        group by 1`,
    ),
    rows<{ id: number; waiting: number; held: number }>(
      db,
      sql`select ${whose}::int as id,
          count(*) filter (where o.status in ('pending_approval', 'finance_check', 'ready_for_invoice'))::int as waiting,
          count(*) filter (where o.status in ('on_hold', 'exception') or (o.status = 'draft' and o.flag_reason is not null))::int as held
        from sales_order o where ${whose} in (${ids(personIds)}) group by 1`,
    ),
    rows<{ id: number; amount: number }>(
      db,
      sql`select person_id::int as id, amount::float8 as amount from sales_target where month = ${first}::date and person_id in (${ids(personIds)})`,
    ),
  ]);
  const map = new Map<number, Figures>();
  for (const id of personIds) {
    const s = sold.find((row) => row.id === id);
    const p = placed.find((row) => row.id === id);
    const n = now.find((row) => row.id === id);
    map.set(id, {
      sold: s?.sold ?? 0,
      today: s?.today ?? 0,
      placed: p?.placed ?? 0,
      placedValue: p?.value ?? 0,
      waiting: n?.waiting ?? 0,
      held: n?.held ?? 0,
      target: targets.find((row) => row.id === id)?.amount ?? null,
    });
  }
  return map;
}

type PersonRow = {
  id: number;
  name: string;
  role: Role;
  title: string | null;
  area: string | null;
  channel: string | null;
  reportsToId: number | null;
};

/** Puts people in the order of their tree (each one followed by those under them), with depth. */
function treeOrder(people: PersonRow[], topIds: number[]): (PersonRow & { depth: number })[] {
  const out: (PersonRow & { depth: number })[] = [];
  const seen = new Set<number>();
  const walk = (person: PersonRow, depth: number) => {
    if (seen.has(person.id)) return;
    seen.add(person.id);
    out.push({ ...person, depth });
    for (const under of people.filter((row) => row.reportsToId === person.id))
      walk(under, depth + 1);
  };
  for (const top of people.filter(
    (row) => topIds.includes(row.id) || !people.some((other) => other.id === row.reportsToId),
  ))
    walk(top, 0);
  return out;
}

const personColumns = sql`p.id::int as id, p.name, p.role, p.title, a.name as area, ch.code as channel, p.reports_to::int as "reportsToId"`;
const personFrom = sql`from person p left join area a on a.id = p.area_id left join channel ch on ch.id = p.channel_id`;

/** A team's month: everyone under a team lead or manager (the whole company for the Admin and
 *  the CEO), each against their target, and the team's orders stopped now. */
export async function teamSales(db: Database, me: Me, asked?: string): Promise<TeamSales> {
  const whole = WHOLE.includes(me.role);
  if (!whole && !LEADS.includes(me.role))
    throw new Refusal(
      403,
      "not_allowed",
      "Team sales are for team leads, managers, the CEO and the Admin.",
    );
  const facts = monthFacts(asked);
  const people = await rows<PersonRow>(
    db,
    whole
      ? sql`select ${personColumns} ${personFrom} where p.active and p.role in (${list(SELLERS)})
          order by ch.sort nulls last, p.name`
      : sql`with recursive team as (
            select id from person where reports_to = ${me.id}
            union all select q.id from person q join team t on q.reports_to = t.id
          )
          select ${personColumns} ${personFrom} where p.active and p.id in (select id from team) and p.role in (${list(SELLERS)})
          order by p.name`,
  );
  const ordered = treeOrder(people, []);
  const [figures, lead, stopped, everything] = await Promise.all([
    figuresOf(
      db,
      ordered.map((person) => person.id),
      facts,
    ),
    whole
      ? Promise.resolve([])
      : rows<{ name: string; title: string | null; channel: string | null }>(
          db,
          sql`select p.name, p.title, ch.name as channel from person p left join channel ch on ch.id = p.channel_id where p.id = ${me.id}`,
        ),
    ordered.length === 0
      ? Promise.resolve([])
      : rows<Omit<TeamSales["stopped"][number], "statusLabel">>(
          db,
          sql`select o.id::int as id, o.code, c.name as customer, rep.name as medrep, o.status, o.flag_reason as reason
            from sales_order o join customer c on c.id = o.customer_id join person rep on rep.id = o.medrep_id
            where ${creditedTo(todayManila())} in (${ids(ordered.map((person) => person.id))})
              and (o.status in ('on_hold', 'exception') or (o.status = 'draft' and o.flag_reason is not null))
            order by o.updated_at desc limit 20`,
        ),
    // The company's whole month counts every invoice, whoever's order it was.
    whole
      ? rows<{ sold: number; today: number }>(
          db,
          sql`select coalesce(sum(i.total), 0)::float8 as sold, coalesce(sum(i.total) filter (where i.issued_on = ${facts.today}::date), 0)::float8 as today
            from sale_invoice i where ${soldIn(facts)}`,
        )
      : Promise.resolve([]),
  ]);
  const rowsOut: SellerFigures[] = ordered.map((person) => {
    const f = figures.get(person.id) ?? NOTHING;
    return {
      personId: person.id,
      name: person.name,
      roleLabel: ROLE_LABEL[person.role],
      title: person.title,
      area: person.area,
      channel: person.channel,
      reportsToId: person.reportsToId,
      depth: person.depth,
      target: f.target,
      sold: f.sold,
      today: f.today,
      placed: f.placed,
      placedValue: f.placedValue,
      waiting: f.waiting,
      held: f.held,
      pct: pctOf(f.sold, f.target),
      tone: paceTone(f.sold, f.target, facts.pace),
    };
  });
  const sum = (key: "sold" | "today" | "placed" | "placedValue") =>
    rowsOut.reduce((total, row) => total + row[key], 0);
  const targets = rowsOut.filter((row) => row.target !== null);
  const target = targets.length
    ? targets.reduce((total, row) => total + (row.target ?? 0), 0)
    : null;
  const sold = whole ? (everything[0]?.sold ?? 0) : sum("sold");
  return {
    ...facts,
    lead: whole ? null : (lead[0] ?? null),
    total: {
      target,
      sold,
      today: whole ? (everything[0]?.today ?? 0) : sum("today"),
      placed: sum("placed"),
      placedValue: sum("placedValue"),
      pct: pctOf(sold, target),
      tone: paceTone(sold, target, facts.pace),
    },
    people: rowsOut,
    stopped: stopped.map((row) => ({
      ...row,
      statusLabel: row.status === "draft" ? "Sent back" : STATUS_LABEL[row.status as OrderStatus],
    })),
    can: { setTargets: true },
  };
}

/** Monthly targets (alias `t`) shared out over the days counted: a whole month counts whole. */
const targetShare = (facts: MonthFacts): SQL => {
  const { first, next } = boundsOf(facts);
  return sql`t.amount * greatest(0, least(${next}::date, (t.month + interval '1 month')::date) - greatest(${first}::date, t.month))::float8
    / ((t.month + interval '1 month')::date - t.month)`;
};

/** Each channel's month: what it sold (its orders' invoices) against its people's targets. */
export async function channelSales(db: Database, facts: MonthFacts): Promise<ChannelFigures[]> {
  const found = await rows<Omit<ChannelFigures, "pct" | "tone"> & { active: boolean }>(
    db,
    sql`select ch.id::int as id, ch.code, ch.name, ch.active, h.name as head,
        (select nullif(sum(${targetShare(facts)}), 0) from sales_target t join person p on p.id = t.person_id
          where p.channel_id = ch.id and p.active)::float8 as target,
        coalesce((select sum(i.total) from sale_invoice i where i.channel_id = ch.id and ${soldIn(facts)}), 0)::float8 as sold,
        coalesce((select sum(i.total) from sale_invoice i where i.channel_id = ch.id and ${soldIn(facts)} and i.issued_on = ${facts.today}::date), 0)::float8 as today
      from channel ch left join person h on h.id = ch.head_id
      order by ch.sort, ch.id`,
  );
  // A retired channel shows only while it still has sales in the days asked.
  return found
    .filter(({ active, sold }) => active || sold > 0)
    .map(({ active: _, ...row }) => ({
      ...row,
      pct: pctOf(row.sold, row.target),
      tone: paceTone(row.sold, row.target, facts.pace),
    }));
}

/** Every box of the Company tree with the business it is in and the channel it counts for, as the
 *  tree draws it and the target sheet names it (Head → Channel): the box straight under a business
 *  (HOSP, RX Business, CLIDP); a business's own box for the seats straight under its head (Modern
 *  Trade's). Closed boxes too, so a seat's past sales still find their place. */
export const SHEET_PLACE = sql`place as (
    select b.id, b.id as business, b.id as box, 0 as depth from org_unit b join org_unit c on c.id = b.parent_id and c.kind = 'company'
    union all
    select k.id, p.business, case when p.depth = 0 then k.id else p.box end, p.depth + 1 from org_unit k join place p on k.parent_id = p.id)`;
/** A channel's name as the target sheet writes it (Aryan, 22 Nov: "the sheet's names": B2B, BID,
 *  MT, not the box's B2B Telesales, Government Bidding, Modern Trade): the word the latest sheet
 *  gives the rows of the box's seats; a box on no row (PAP, Government Account) keeps its own
 *  name. The boxes are not renamed (code and scripts find them by name). Needs SHEET_PLACE. */
export const sheetNameOfBox = (box: SQL): SQL =>
  sql`coalesce((select r.channel from target_sheet_row r join seat rs on rs.id = r.seat_id join place rp on rp.id = rs.unit_id
      where rp.box = ${box} and r.month = (select max(month) from target_sheet_row)
      group by r.channel order by count(*) desc, r.channel limit 1),
    (select bx.name from org_unit bx where bx.id = ${box}))`;
/** Who leads a box (alias given) today, by name. */
export const leadOfBox = (box: SQL, today: string): SQL =>
  sql`(select p.name from seat ls join seat_holder lh on lh.seat_id = ls.id and lh.kind = 'holder' and ${inForce("lh", today)} join person p on p.id = lh.person_id
    where ls.unit_id = ${box} and ls.lead and ls.active order by ls.sort, ls.id limit 1)`;

/** Each channel's month as the target sheet has the channels (Aryan, 22 Nov: "one list of channels,
 *  the sheet's"): what its seats sold (their invoices, Zoho's and ours) against the targets set on
 *  those seats, with who manages it and the business it is under. Sales by a seller tied to no seat
 *  come last, so the rows add up to the company's figure. */
export async function sheetChannelSales(db: Database, facts: MonthFacts): Promise<ChannelFigures[]> {
  const today = facts.today;
  const found = await rows<{ id: number; name: string; business: string; own: boolean; manager: string | null; head: string | null; target: number | null; sold: number; today: number; people: number; customers: number }>(
    db,
    sql`with recursive ${SHEET_PLACE},
      sold as (
        select i.seat_id, sum(i.total) as sold, coalesce(sum(i.total) filter (where i.issued_on = ${today}::date), 0) as today
        from sale_invoice i where ${soldIn(facts)} group by 1),
      figures as (
        select pl.business, pl.box, coalesce(sum(so.sold), 0)::float8 as sold, coalesce(sum(so.today), 0)::float8 as today,
          nullif(sum((select sum(${targetShare(facts)}) from seat_target t where t.seat_id = st.id)), 0)::float8 as target,
          -- Someone sells in it: in a business's own box, someone other than its head.
          bool_or(st.active and box.active and st.module in ('medrep', 'online', 'team_lead', 'manager') and (pl.box <> pl.business or not st.lead)
            -- PAP is a process, not a channel (22 Nov): its box is listed only while old sales sit on it.
            and box.channel_id is distinct from (select pc.id from channel pc where pc.code = 'PAP')) as selling
        from seat st join place pl on pl.id = st.unit_id join org_unit box on box.id = pl.box left join sold so on so.seat_id = st.id
        group by 1, 2)
      select box.id::int as id, ${sheetNameOfBox(sql`box.id`)} as name, biz.name as business, box.id = biz.id as own,
        ${leadOfBox(sql`box.id`, today)} as manager, ${leadOfBox(sql`biz.id`, today)} as head, f.target, f.sold, f.today,
        (select count(distinct lh.person_id) from seat st join place pl on pl.id = st.unit_id
            join seat_holder lh on lh.seat_id = st.id and lh.kind = 'holder' and ${inForce("lh", today)}
          where st.active and pl.box = box.id)::int as people,
        (select count(*) from customer c where c.active and c.area_id in
          (select st.area_id from seat st join place pl on pl.id = st.unit_id where pl.box = box.id and st.area_id is not null))::int as customers
      from figures f join org_unit box on box.id = f.box join org_unit biz on biz.id = f.business
      where biz.kind = 'business' and (f.sold > 0 or f.target is not null or f.selling)
      order by biz.sort, biz.id, box.id = biz.id, box.sort, box.id`,
  );
  const [all] = await rows<{ sold: number; today: number }>(
    db,
    sql`select coalesce(sum(i.total), 0)::float8 as sold, coalesce(sum(i.total) filter (where i.issued_on = ${today}::date), 0)::float8 as today
      from sale_invoice i where ${soldIn(facts)}`,
  );
  const listed: ChannelFigures[] = found.map((row) => ({
    id: row.id,
    code: "",
    name: row.name,
    // Who manages it (its own lead, else the business's head), then the business it is under.
    head: [row.manager ?? row.head ?? "No manager named", row.own ? null : row.business].filter(Boolean).join(" · "),
    business: row.business as string | null,
    people: row.people,
    customers: row.customers,
    target: row.target,
    sold: row.sold,
    today: row.today,
    pct: pctOf(row.sold, row.target),
    tone: paceTone(row.sold, row.target, facts.pace),
  }));
  const rest = (all?.sold ?? 0) - listed.reduce((sum, row) => sum + row.sold, 0);
  if (Math.abs(rest) >= 1)
    listed.push({
      id: 0,
      code: "",
      name: "Not tied to a seat yet",
      head: "Old-system sales by a seller with no seat on the tree",
      business: null,
      target: null,
      sold: rest,
      today: (all?.today ?? 0) - listed.reduce((sum, row) => sum + row.today, 0),
      pct: null,
      tone: paceTone(rest, null, facts.pace),
    });
  return listed;
}

/** The CEO's first screen: the month in four figures, the company in summaries, the channels
 *  against their targets, and what needs the CEO now. */
export async function ceoHome(
  db: Database,
  me: Me,
  asked?: string,
  days?: { from?: string; to?: string },
): Promise<CeoHome> {
  if (!WHOLE.includes(me.role))
    throw new Refusal(403, "not_allowed", "The CEO Home is for the CEO and the Admin.");
  const facts = periodFacts({ month: asked, ...days });
  const before = periodBefore(facts);
  const { first, next } = boundsOf(facts);
  const today = facts.today;
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 90 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  // Ordered from suppliers and not received yet: what will be paid out (in pesos, landed).
  const [buying] = await rows<{ count: number; value: number }>(
    db,
    sql`select count(*)::int as count, coalesce(sum(goods_total + extras_total), 0)::float8 as value
      from purchase where state = 'ordered'`,
  );
  // Suppliers' unpaid bills (the books: Zoho's and the ones made here) with their openings.
  const [bills] = await rows<{ count: number; value: number }>(
    db,
    sql`select count(*)::int as count,
        ((select coalesce(sum(opening_payables), 0) from supplier) + coalesce(sum(round(balance * fx_rate)), 0))::float8 as value
      from book_doc where kind = 'bill' and balance > 0 and status not in ('void', 'draft', 'pending_approval')`,
  );
  const [channels, totals, money, orders, dispatch, stock, counts] = await Promise.all([
    sheetChannelSales(db, facts),
    rows<{
      achieved: number;
      today: number;
      collected: number;
      before: number;
      target: number | null;
    }>(
      db,
      sql`select
          coalesce((select sum(i.total) from sale_invoice i where ${soldIn(facts)}), 0)::float8 as achieved,
          coalesce((select sum(i.total) from sale_invoice i where ${soldIn(facts)} and i.issued_on = ${today}::date), 0)::float8 as today,
          -- Money only, as Finance's Home counts it: a bill settled with the customer's credit, a
          -- deduction, tax withheld or points brought no money in (the two Homes disagreed, 23 Nov).
          coalesce((select sum(amount) from payment where active and method not in ('points', 'withholding', 'credit', 'deduction') and paid_on >= ${first}::date and paid_on < ${next}::date), 0)::float8 as collected,
          coalesce((select sum(amount) from payment where active and method not in ('points', 'withholding', 'credit', 'deduction') and paid_on >= ${before.from}::date and paid_on <= ${before.to}::date), 0)::float8 as before,
          -- The targets set on the seats (the target sheet's, the vacant seats' too), so the headline is
          -- the sum of the channels under it; a month from before seats had targets: its people's.
          coalesce((select nullif(sum(${targetShare(facts)}), 0) from seat_target t),
            (select nullif(sum(${targetShare(facts)}), 0) from sales_target t join person p on p.id = t.person_id where p.active))::float8 as target`,
    ),
    rows<{
      owed: number;
      onDelivery: number;
      overdue: number;
      late: number;
      refunds: number;
      cod: number;
    }>(
      db,
      sql`select coalesce(sum(i.total - i.paid) filter (where i.status = 'open' and not (i.terms = 'cod' and o.status <> 'completed')), 0)::float8 as owed,
          coalesce(sum(i.total - i.paid) filter (where i.status = 'open' and i.terms = 'cod' and o.status <> 'completed'), 0)::float8 as "onDelivery",
          coalesce(sum(i.total - i.paid) filter (where i.status = 'open' and i.terms = 'cod' and o.status = 'shipped'), 0)::float8 as cod,
          coalesce(sum(i.total - i.paid) filter (where i.status = 'open' and i.due_on < ${today}::date and not (i.terms in ('cod', 'days') and o.status <> 'completed')), 0)::float8 as overdue,
          count(distinct i.customer_id) filter (where i.status = 'open' and i.due_on < (${today}::date - 60) and not (i.terms in ('cod', 'days') and o.status <> 'completed'))::int as late,
          coalesce(sum(i.paid - (select coalesce(sum(pp.amount), 0) from payment pp where pp.invoice_id = i.id and pp.active and pp.method in ('points', 'withholding', 'credit', 'deduction')) - i.refunded) filter (where i.status = 'cancelled' and i.paid - (select coalesce(sum(pp.amount), 0) from payment pp where pp.invoice_id = i.id and pp.active and pp.method in ('points', 'withholding', 'credit', 'deduction')) > i.refunded), 0)::float8 as refunds
        from invoice i join sales_order o on o.id = i.order_id`,
    ),
    rows<CeoHome["orders"]>(
      db,
      sql`select count(*) filter (where status = 'pending_approval')::int as awaiting,
          count(*) filter (where status in ('finance_check', 'ready_for_invoice'))::int as finance,
          count(*) filter (where status in ('on_hold', 'exception'))::int as "onHold",
          count(*) filter (where o.status in ('pending_approval', 'finance_check', 'ready_for_invoice') and ${stuckNow()})::int as stuck,
          (max(extract(epoch from now() - coalesce(submitted_at, created_at)) / 3600) filter (where status = 'pending_approval'))::int as "oldestHours",
          count(*) filter (where status not in ('draft', 'cancelled') and (coalesce(submitted_at, created_at) at time zone 'Asia/Manila')::date = ${today}::date)::int as today
        from sales_order o`,
    ),
    rows<CeoHome["dispatch"]>(
      db,
      sql`select count(*) filter (where status = 'ready_for_dispatch')::int as "toPack",
          count(*) filter (where status = 'packing')::int as "toShip",
          count(*) filter (where status = 'shipped')::int as "onTheWay",
          count(*) filter (where status = 'completed' and delivered_on = ${today}::date)::int as "deliveredToday"
        from sales_order`,
    ),
    rows<CeoHome["stock"]>(
      db,
      sql`with shelf as (
            select m.id, m.reorder_level, coalesce(sum(s.qty) filter (where b.expires_on >= ${today}::date), 0) as qty
            from medicine m left join batch b on b.medicine_id = m.id left join stock s on s.batch_id = b.id
            where m.active group by m.id, m.reorder_level
          )
          select (select count(*) from shelf)::int as medicines,
            (select count(*) from shelf where qty = 0)::int as out,
            (select count(*) from shelf where qty > 0 and qty <= reorder_level)::int as low,
            (select count(distinct b.id) from batch b join stock s on s.batch_id = b.id
              where s.qty > 0 and b.expires_on >= ${today}::date and b.expires_on <= ${soon}::date)::int as expiring,
            (select sum(s.qty * b.unit_cost) from stock s join batch b on b.id = s.batch_id where s.qty > 0 and b.expires_on >= ${today}::date)::float8 as value`,
    ),
    rows<{
      customers: number;
      toReview: number;
      people: number;
      sellers: number;
      withoutTarget: number;
    }>(
      db,
      sql`select (select count(*) from customer where active)::int as customers,
          (select count(*) from customer where active and review = 'to_review')::int as "toReview",
          (select count(*) from person where active)::int as people,
          (select count(*) from person where active and role = 'medrep')::int as sellers,
          (select count(*) from person p where p.active and p.role = 'medrep'
            and not exists (select 1 from sales_target t where t.person_id = p.id and t.month = ${first}::date))::int as "withoutTarget"`,
    ),
  ]);
  const total = totals[0] ?? { achieved: 0, today: 0, collected: 0, before: 0, target: null };
  const crmOwed = money[0] ?? { owed: 0, onDelivery: 0, overdue: 0, late: 0, refunds: 0, cod: 0 };
  // What customers still owe on Zoho's invoices (the books), and what Zoho Books kept as opening balances.
  const [zohoOwed] = await rows<{ owed: number; overdue: number; late: number }>(
    db,
    sql`select (coalesce(sum(round(d.balance * d.fx_rate)), 0) + (select coalesce(sum(opening_receivables), 0) from customer))::float8 as owed,
        coalesce(sum(round(d.balance * d.fx_rate)) filter (where d.due_date < ${today}::date), 0)::float8 as overdue,
        count(distinct d.customer_id) filter (where d.due_date < (${today}::date - 60))::int as late
      from book_doc d where d.kind = 'invoice' and d.zoho_id is not null and d.balance > 0 and d.status not in ('void', 'draft')`,
  );
  const owed = {
    ...crmOwed,
    owed: crmOwed.owed + (zohoOwed?.owed ?? 0),
    overdue: crmOwed.overdue + (zohoOwed?.overdue ?? 0),
    late: crmOwed.late + (zohoOwed?.late ?? 0),
  };
  const waiting = orders[0] ?? {
    awaiting: 0,
    finance: 0,
    onHold: 0,
    stuck: 0,
    oldestHours: null,
    today: 0,
  };
  const shelf = stock[0] ?? { medicines: 0, out: 0, low: 0, expiring: 0, value: null };
  const counted = counts[0] ?? {
    customers: 0,
    toReview: 0,
    people: 0,
    sellers: 0,
    withoutTarget: 0,
  };
  const peso = (centavos: number) => `₱${Math.round(centavos / 100).toLocaleString("en-PH")}`;

  const alerts: CeoAlert[] = [];
  if (facts.running)
    for (const channel of channels.filter((row) => row.tone === "far"))
      alerts.push({
        kind: "channel",
        text: `${channel.name} is far behind: ${Math.round(channel.pct ?? 0)}% of ${peso(channel.target ?? 0)}`,
        note: `${facts.daysLeft} ${facts.daysLeft === 1 ? "day" : "days"} left${channel.head ? ` · ${channel.head}` : ""}`,
        href: "/divisions",
        tone: "bad",
      });
  if (waiting.stuck > 0)
    alerts.push({
      kind: "orders",
      text: `${waiting.stuck} ${waiting.stuck === 1 ? "order has" : "orders have"} waited over 2 days`,
      note: "For Management or Finance",
      href: "/orders?stuck=1",
      tone: "bad",
    });
  if (owed.late > 0)
    alerts.push({
      kind: "money",
      text: `${owed.late} ${owed.late === 1 ? "customer is" : "customers are"} over 60 days late`,
      note: `${peso(owed.overdue)} overdue in all`,
      href: "/owed",
      tone: "bad",
    });
  if (owed.refunds > 0)
    alerts.push({
      kind: "refunds",
      text: `${peso(owed.refunds)} to give back for cancelled orders`,
      note: null,
      href: "/refunds",
      tone: "warn",
    });
  if (shelf.out > 0)
    alerts.push({
      kind: "stock",
      text: `${shelf.out} ${shelf.out === 1 ? "medicine is" : "medicines are"} out of stock`,
      note: shelf.low ? `${shelf.low} more low` : null,
      href: "/inventory?show=out",
      tone: "warn",
    });
  if (waiting.onHold > 0)
    alerts.push({
      kind: "orders",
      text: `${waiting.onHold} ${waiting.onHold === 1 ? "order is" : "orders are"} on hold`,
      note: null,
      href: "/on-hold",
      tone: "warn",
    });
  if (counted.toReview > 0)
    alerts.push({
      kind: "customers",
      text: `${counted.toReview} new ${counted.toReview === 1 ? "customer" : "customers"} not checked yet`,
      note: null,
      href: "/customers?review=1",
      tone: "warn",
    });

  return {
    ...facts,
    sales: {
      target: total.target,
      achieved: total.achieved,
      today: total.today,
      collected: total.collected,
      collectedBefore: { amount: total.before, ...before },
      pct: pctOf(total.achieved, total.target),
      tone: paceTone(total.achieved, total.target, facts.pace),
      channels,
    },
    money: {
      owed: owed.owed,
      overdue: owed.overdue,
      lateCustomers: owed.late,
      refundsOwed: owed.refunds,
      codOnTheRoad: owed.cod,
      onDelivery: owed.onDelivery,
      purchasesOpen: buying?.count ?? 0,
      purchasesValue: buying?.value ?? 0,
      billsOpen: bills?.count ?? 0,
      billsValue: bills?.value ?? 0,
    },
    orders: waiting,
    dispatch: dispatch[0] ?? { toPack: 0, toShip: 0, onTheWay: 0, deliveredToday: 0 },
    stock: shelf,
    customers: { total: counted.customers, toReview: counted.toReview },
    people: {
      total: counted.people,
      sellers: counted.sellers,
      withoutTarget: counted.withoutTarget,
    },
    alerts,
  };
}

/** The company tree's data: the CEO, the channels and their heads, each area held by its MedRep
 *  under the person he reports to, and everyone else under their boss; the month's figures on
 *  each area (its MedRep's target and sales) and the sales no area holds on its channel. */
export async function companyTree(db: Database, me: Me, asked?: string): Promise<CompanyTreeData> {
  if (!WHOLE.includes(me.role))
    throw new Refusal(403, "not_allowed", "The company tree is for the CEO and the Admin.");
  const facts = monthFacts(asked);
  const [channels, areas, people] = await Promise.all([
    rows<{
      id: number;
      code: string;
      name: string;
      headId: number | null;
      head: string | null;
      sort: number;
    }>(
      db,
      sql`select ch.id::int as id, ch.code, ch.name, ch.head_id::int as "headId", h.name as head, ch.sort::int as sort
        from channel ch left join person h on h.id = ch.head_id and h.active
        where ch.active order by ch.sort, ch.id`,
    ),
    rows<{
      id: number;
      name: string;
      channelId: number;
      holderId: number | null;
      holder: string | null;
      managerId: number | null;
      manager: string | null;
      cities: string[] | null;
    }>(
      db,
      sql`select a.id::int as id, a.name, a.channel_id::int as "channelId", rep.id::int as "holderId", rep.name as holder,
          boss.id::int as "managerId", boss.name as manager, a.cities
        from area a
        left join lateral (select id, name, reports_to from person where area_id = a.id and role = 'medrep' and active order by id limit 1) rep on true
        left join person boss on boss.id = rep.reports_to
        order by a.channel_id, a.name`,
    ),
    rows<{
      id: number;
      name: string;
      role: Role;
      title: string | null;
      reportsToId: number | null;
    }>(
      db,
      sql`select id::int as id, name, role, title, reports_to::int as "reportsToId" from person where active order by name`,
    ),
  ]);
  const holderIds = areas.map((area) => area.holderId).filter((id): id is number => id !== null);
  const [figures, perChannel] = await Promise.all([
    figuresOf(db, holderIds, facts),
    channelSales(db, facts),
  ]);
  const ceo = people.find((person) => person.role === "ceo") ?? null;
  const territories = areas.map((area, sort) => {
    const f = area.holderId ? (figures.get(area.holderId) ?? NOTHING) : NOTHING;
    return {
      id: `a${area.id}`,
      name: area.name,
      // The old tree's HQ: here, the cities the area covers.
      hq: area.cities?.length ? area.cities.join(", ") : null,
      channelId: `c${area.channelId}`,
      manager: area.manager,
      managerId: area.managerId ? `p${area.managerId}` : null,
      holder: area.holder,
      holderId: area.holderId ? `p${area.holderId}` : null,
      note: null,
      target: f.target ?? 0,
      achieved: f.sold,
      today: f.today,
      sort,
    };
  });
  return {
    month: facts.month,
    today: facts.today,
    asOf: null,
    company: companyNow()?.name ?? "2MG Inc.",
    ceo: ceo?.name ?? null,
    ceoId: ceo ? `p${ceo.id}` : null,
    channels: channels.map((channel) => {
      const sold = perChannel.find((row) => row.id === channel.id);
      const onAreas = territories.filter((t) => t.channelId === `c${channel.id}`);
      return {
        id: `c${channel.id}`,
        code: channel.code,
        name: channel.name,
        head: channel.head,
        headId: channel.headId ? `p${channel.headId}` : null,
        sort: channel.sort,
        // What the channel sold that no area's MedRep holds (an order Management or the desk placed).
        crmAchieved: Math.max(
          0,
          (sold?.sold ?? 0) - onAreas.reduce((sum, t) => sum + t.achieved, 0),
        ),
        crmToday: Math.max(0, (sold?.today ?? 0) - onAreas.reduce((sum, t) => sum + t.today, 0)),
      };
    }),
    territories,
    people: people.map((person) => ({
      id: `p${person.id}`,
      name: person.name,
      code: null,
      department: ROLE_LABEL[person.role],
      position: person.title,
      reportsToId: person.reportsToId ? `p${person.reportsToId}` : null,
      status: "active",
      hasLogin: true,
      userId: `p${person.id}`,
      rep: person.role === "medrep",
    })),
  };
}

/** A channel's sales opened up (see ChannelSalesDetail). */
export async function channelSalesDetail(
  db: Database,
  facts: MonthFacts,
  code: string,
): Promise<ChannelSalesDetail> {
  const [channel] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from channel where code = ${code}`,
  );
  if (!channel) throw new Refusal(404, "not_found", "No such channel.");
  const sold = soldIn(facts);
  const whose = creditedTo(todayManila());
  const [people, customers, medicines] = await Promise.all([
    rows<ChannelSalesDetail["people"][number]>(
      db,
      sql`select p.id::int as id, p.name, a.name as area,
          coalesce((select sum(i.total) from ${saleAs} where o.channel_id = ${channel.id} and ${whose} = p.id and ${sold}), 0)::float8 as sold,
          (select sum(${targetShare(facts)}) from sales_target t where t.person_id = p.id)::float8 as target,
          (select count(distinct o.id) from ${saleAs} where o.channel_id = ${channel.id} and ${whose} = p.id and ${sold})::int as orders
        from person p left join area a on a.id = p.area_id
        where p.active and (p.channel_id = ${channel.id} or exists (select 1 from ${saleAs}
          where ${whose} = p.id and o.channel_id = ${channel.id} and ${sold}))
          and (p.role in ('medrep', 'team_lead', 'manager') or exists (select 1 from sales_order o where ${whose} = p.id and o.channel_id = ${channel.id}))
        order by sold desc, p.name`,
    ),
    rows<ChannelSalesDetail["customers"][number]>(
      db,
      sql`select c.id::int as id, c.name, c.kind, sum(i.total)::float8 as sold, count(distinct o.id)::int as orders
        from ${saleAs} join customer c on c.id = i.customer_id
        where o.channel_id = ${channel.id} and ${sold}
        group by c.id, c.name, c.kind order by sold desc limit 50`,
    ),
    rows<ChannelSalesDetail["medicines"][number]>(
      db,
      sql`select name, sum(qty)::int as qty, sum(value)::float8 as value from (
          select m.name || coalesce(' ' || m.strength, '') as name, oi.qty, oi.qty * oi.unit_price as value
          from invoice i join sales_order o on o.id = i.order_id join order_item oi on oi.order_id = o.id join medicine m on m.id = oi.medicine_id
          where o.channel_id = ${channel.id} and ${sold}
          union all
          -- Zoho's invoices of the channel's seats: their lines, under the medicine or Zoho's item name.
          select coalesce(m.name || coalesce(' ' || m.strength, ''), l.item_name), l.qty::int, round(coalesce(l.amount, 0) * d.fx_rate)
          from sale_invoice i join book_doc d on d.id = i.id and i.source = 'zoho' join book_line l on l.doc_id = d.id left join medicine m on m.id = l.medicine_id
          where i.channel_id = ${channel.id} and ${sold}
        ) x group by name order by value desc limit 50`,
    ),
  ]);
  return { people, customers, medicines };
}
