// B2B Telesales (docs/PLAN.md 16.4): NBD brings business accounts in (prospect → called →
// papers in → first order → handed to CRR at the 3rd order or day 90; no 2nd order by day 45 is
// flagged); CRR keeps them buying, each against its own usual gap and its 3-month average; the
// coach sees the pipeline per NBD, the hand-overs waiting and the accounts slipping per CRR.
// The seat's title tells NBD from CRR ("NBD", "CRR" as the 2026 chart names them).

import { sql } from "drizzle-orm";
import { addCustomer } from "../customers/service";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { inForce } from "../org/service";
import { teamSeats } from "../team/service";
import type { B2bTeam, CrrDay, CustomerInput, Me, NbdDay } from "../types";

export type B2bRole = "nbd" | "crr" | "clidp" | null;
/** NBD, CRR or CLIDP inside Sales and Marketing, by the seat's title as the chart names them. */
export const b2bRole = (me: Pick<Me, "role" | "title" | "channel">): B2bRole =>
  me.role !== "medrep" || me.channel?.code !== "B2B"
    ? null
    : /\bNBD\b|New Business/i.test(me.title ?? "")
      ? "nbd"
      : /\bCRR\b|Retention/i.test(me.title ?? "")
        ? "crr"
        : /CLIDP/i.test(me.title ?? "")
          ? "clidp"
          : null;

const B2B_KINDS = ["drugstore", "distributor", "hospital"] as const;
const READY_ORDERS = 3;
const READY_DAYS = 90;
const FLAG_DAYS = 45;
const days = (from: string | null, to: string) =>
  from ? Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) : null;

type Prospect = NbdDay["prospects"][number];

async function prospectsOf(db: Database, nbdIds: number[], today: string, open: boolean) {
  if (!nbdIds.length) return [] as Prospect[];
  const found = await rows<Omit<Prospect, "missing" | "stage" | "ready" | "flagged" | "callDue" | "sinceFirst">>(
    db,
    sql`select c.id::int as "customerId", c.name, c.kind, c.city, c.phone, a.nbd_id::int as "nbdId", n.name as nbd,
        c.licence_no as "licenceNo", to_char(c.licence_expires, 'YYYY-MM-DD') as "licenceExpires",
        c.permit_no as "permitNo", to_char(c.permit_expires, 'YYYY-MM-DD') as "permitExpires", c.tin,
        to_char(a.next_call_on, 'YYYY-MM-DD') as "nextCallOn", to_char(a.handed_over_at at time zone 'Asia/Manila', 'YYYY-MM-DD') as "handedOverOn",
        r.name as crr,
        (select count(*) from account_call k where k.customer_id = c.id)::int as calls,
        (select k.outcome from account_call k where k.customer_id = c.id order by k.at desc limit 1) as "lastOutcome",
        (select to_char(max(k.at) at time zone 'Asia/Manila', 'YYYY-MM-DD') from account_call k where k.customer_id = c.id) as "lastCallOn",
        (select to_char(min(i.issued_on), 'YYYY-MM-DD') from invoice i where i.customer_id = c.id and i.status <> 'cancelled') as "firstOrderOn",
        (select count(*) from invoice i where i.customer_id = c.id and i.status <> 'cancelled')::int as orders
      from b2b_account a join customer c on c.id = a.customer_id left join person n on n.id = a.nbd_id left join person r on r.id = a.crr_id
      where a.nbd_id in (${sql.join(nbdIds.map((id) => sql`${id}`), sql`, `)}) and a.dropped_at is null
        and ${open ? sql`a.handed_over_at is null` : sql`a.handed_over_at is not null`}
      order by a.next_call_on nulls first, c.name`,
  );
  return found.map((one): Prospect => {
    const missing: Prospect["missing"] = [];
    if (!one.licenceNo || (one.licenceExpires && one.licenceExpires < today)) missing.push(one.licenceNo ? "licence expired" : "FDA licence");
    if (!one.permitNo || (one.permitExpires && one.permitExpires < today)) missing.push(one.permitNo ? "permit expired" : "business permit");
    if (!one.tin) missing.push("BIR (TIN)");
    const sinceFirst = days(one.firstOrderOn, today);
    return {
      ...one,
      missing,
      sinceFirst,
      stage: one.firstOrderOn ? "ordered" : missing.length === 0 ? "papers" : one.calls > 0 ? "contacted" : "prospect",
      ready: one.orders >= READY_ORDERS || (sinceFirst !== null && sinceFirst >= READY_DAYS),
      flagged: one.orders === 1 && sinceFirst !== null && sinceFirst > FLAG_DAYS,
      callDue: !one.nextCallOn ? one.calls === 0 : one.nextCallOn <= today,
    };
  });
}

export async function nbdDay(db: Database, me: Me): Promise<NbdDay> {
  if (b2bRole(me) !== "nbd") throw new Refusal(403, "not_allowed", "This is the NBD's desk (New Business Development).");
  const today = todayManila();
  const first = `${today.slice(0, 7)}-01`;
  const [prospects, handed, [month]] = await Promise.all([
    prospectsOf(db, [me.id], today, true),
    prospectsOf(db, [me.id], today, false),
    rows<{ firstOrders: number; worked: number }>(
      db,
      sql`select
          (select count(*) from b2b_account a where a.nbd_id = ${me.id}
            and (select min(i.issued_on) from invoice i where i.customer_id = a.customer_id and i.status <> 'cancelled') >= ${first}::date)::int as "firstOrders",
          (select count(distinct k.customer_id) from account_call k join b2b_account a on a.customer_id = k.customer_id and a.nbd_id = ${me.id}
            where k.by_person = ${me.id} and k.at >= ${first}::date)::int as worked`,
    ),
  ]);
  return {
    today,
    prospects,
    handedOver: handed.slice(0, 50),
    month: {
      firstOrders: month?.firstOrders ?? 0,
      worked: month?.worked ?? 0,
      conversion: month?.worked ? Math.round(((month.firstOrders ?? 0) / month.worked) * 100) : null,
    },
  };
}

type Account = CrrDay["accounts"][number];

/** The accounts a CRR looks after (handed to them, or of their seat's area) and each one's health. */
export async function accountsOf(db: Database, crrIds: number[], areaIds: number[], today: string): Promise<Account[]> {
  if (!crrIds.length && !areaIds.length) return [];
  const first = `${today.slice(0, 7)}-01`;
  const prevFirst = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10);
  const ids = (list: number[]) => (list.length ? sql.join(list.map((id) => sql`${id}`), sql`, `) : sql`0`);
  const found = await rows<Omit<Account, "state" | "trend">>(
    db,
    sql`with mine as (
        select c.id from customer c where c.active and c.kind in ('drugstore', 'distributor', 'hospital')
          and (c.id in (select customer_id from b2b_account where crr_id in (${ids(crrIds)}) and dropped_at is null)
            or (c.area_id in (${ids(areaIds)}) and not exists (select 1 from b2b_account b where b.customer_id = c.id and b.handed_over_at is null)))
      ),
      days as (
        select i.customer_id as cid, i.issued_on as d, i.total::float8 as total from invoice i where i.customer_id in (select id from mine) and i.status <> 'cancelled'
        union all
        select p.customer_id, p.ordered_on, p.total::float8 from past_order p where p.customer_id in (select id from mine) and p.status <> 'void'
      ),
      g as (select cid, d, total, d - lag(d) over (partition by cid order by d) as gap, row_number() over (partition by cid order by d desc) as rn
        from (select cid, d, sum(total) as total from days group by cid, d) x),
      s as (select cid, max(d) as last,
          greatest(7, coalesce(percentile_cont(0.5) within group (order by gap) filter (where gap is not null and rn <= 7), 28))::float8 as usual,
          coalesce(sum(total) filter (where d > ${today}::date - 30), 0) as "last30",
          coalesce(sum(total) filter (where d > ${today}::date - 120 and d <= ${today}::date - 30), 0) / 3.0 as "avg3",
          bool_or(d between ${prevFirst}::date and (${first}::date - 1)) as "lastMonth", bool_or(d >= ${first}::date) as "thisMonth"
        from g group by cid)
      select c.id::int as "customerId", c.name, c.kind, c.city, c.phone,
        to_char(s.last, 'YYYY-MM-DD') as "lastOrderOn", round(s.usual)::int as usual, (${today}::date - s.last)::int as since,
        to_char(s.last + round(s.usual)::int, 'YYYY-MM-DD') as "expectedOn", s."last30", s."avg3",
        coalesce(s."lastMonth", false) as "lastMonth", coalesce(s."thisMonth", false) as "thisMonth",
        (select k.outcome from account_call k where k.customer_id = c.id order by k.at desc limit 1) as "lastOutcome",
        (select to_char(max(k.at) at time zone 'Asia/Manila', 'YYYY-MM-DD') from account_call k where k.customer_id = c.id) as "lastCallOn",
        (select r.name from b2b_account a join person r on r.id = a.crr_id where a.customer_id = c.id) as crr
      from mine join customer c on c.id = mine.id join s on s.cid = c.id
      where ${today}::date - s.last <= 730
      order by s.last desc`,
  );
  const weekAhead = addDays(today, 7);
  return found.map((one) => ({
    ...one,
    state: one.since > 180 ? "lost" : one.since > 90 ? "stopped" : one.since > 1.5 * one.usual ? "late" : one.expectedOn <= weekAhead ? "due" : "ok",
    trend: one.avg3 <= 0 ? (one.last30 > 0 ? "up" : "flat") : one.last30 > one.avg3 * 1.1 ? "up" : one.last30 < one.avg3 * 0.9 ? "down" : "flat",
  }));
}

export async function seatAreas(db: Database, personId: number, today: string): Promise<number[]> {
  const found = await rows<{ id: number }>(
    db,
    sql`select s.area_id::int as id from seat_holder h join seat s on s.id = h.seat_id
      where h.person_id = ${personId} and ${inForce("h", today)} and s.area_id is not null`,
  );
  return found.map((row) => row.id);
}

export async function crrDay(db: Database, me: Me): Promise<CrrDay> {
  if (b2bRole(me) !== "crr") throw new Refusal(403, "not_allowed", "This is the CRR's desk (Client Retention & Reorder).");
  const today = todayManila();
  const accounts = await accountsOf(db, [me.id], await seatAreas(db, me.id, today), today);
  const last = accounts.filter((one) => one.lastMonth);
  return {
    today,
    accounts,
    month: {
      retention: last.length ? Math.round((last.filter((one) => one.thisMonth).length / last.length) * 100) : null,
      up: accounts.filter((one) => one.state !== "lost" && one.trend === "up").length,
      flat: accounts.filter((one) => one.state !== "lost" && one.trend === "flat").length,
      down: accounts.filter((one) => one.state !== "lost" && one.trend === "down").length,
    },
  };
}

/** NBD adds a prospect: a new business customer, or one already on file not yet anyone's. */
export async function addProspect(db: Database, me: Me, input: { customerId?: number | null; customer?: CustomerInput | null }): Promise<{ customerId: number }> {
  if (b2bRole(me) !== "nbd") throw new Refusal(403, "not_allowed", "NBD adds prospects.");
  let customerId = input.customerId ?? null;
  if (!customerId) {
    if (!input.customer) throw new Refusal(400, "invalid", "Pick the business or type its details.", "customer");
    if (!(B2B_KINDS as readonly string[]).includes(input.customer.kind))
      throw new Refusal(400, "invalid", "A prospect is a drugstore, a distributor or a clinic / hospital.", "kind");
    customerId = await addCustomer(db, me, input.customer);
  }
  const [taken] = await rows<{ nbd: string | null }>(
    db,
    sql`select n.name as nbd from b2b_account a left join person n on n.id = a.nbd_id where a.customer_id = ${customerId} and a.dropped_at is null`,
  );
  if (taken) throw new Refusal(409, "taken", `${taken.nbd ?? "Someone"} already works this account.`);
  await db.execute(
    sql`insert into b2b_account (customer_id, nbd_id, next_call_on) values (${customerId}, ${me.id}, ${todayManila()}::date)
      on conflict (customer_id) do update set nbd_id = excluded.nbd_id, dropped_at = null, dropped_reason = null, next_call_on = excluded.next_call_on`,
  );
  return { customerId };
}

/** Whether the account is this NBD's or CRR's (or under this coach). */
async function mayWork(db: Database, me: Me, customerId: number): Promise<boolean> {
  const [own] = await rows<{ nbd: number | null; crr: number | null }>(
    db,
    sql`select nbd_id::int as nbd, crr_id::int as crr from b2b_account where customer_id = ${customerId}`,
  );
  if (own && (own.nbd === me.id || own.crr === me.id)) return true;
  if (b2bRole(me) === "crr") {
    const areas = await seatAreas(db, me.id, todayManila());
    const [inArea] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from customer where id = ${customerId} and area_id in (${areas.length ? sql.join(areas.map((id) => sql`${id}`), sql`, `) : sql`0`})`,
    );
    return Boolean(inArea?.n);
  }
  return ["team_lead", "manager"].includes(me.role) && me.channel?.code === "B2B";
}

export async function logCall(db: Database, me: Me, input: { customerId: number; outcome: string; note?: string | null; nextOn?: string | null }): Promise<void> {
  if (!(await mayWork(db, me, input.customerId))) throw new Refusal(403, "not_allowed", "Not one of your accounts.");
  await db.execute(
    sql`insert into account_call (customer_id, by_person, outcome, note, next_on)
      values (${input.customerId}, ${me.id}, ${input.outcome}, ${input.note?.trim() || null}, ${input.nextOn ?? null})`,
  );
  if (input.nextOn !== undefined)
    await db.execute(sql`update b2b_account set next_call_on = ${input.nextOn ?? null} where customer_id = ${input.customerId}`);
}

export async function savePapers(
  db: Database,
  me: Me,
  input: { customerId: number; licenceNo?: string | null; licenceExpires?: string | null; permitNo?: string | null; permitExpires?: string | null; tin?: string | null },
): Promise<void> {
  if (!(await mayWork(db, me, input.customerId))) throw new Refusal(403, "not_allowed", "Not one of your accounts.");
  await db.execute(
    sql`update customer set licence_no = coalesce(${input.licenceNo?.trim() || null}, licence_no),
        licence_expires = coalesce(${input.licenceExpires || null}::date, licence_expires),
        permit_no = coalesce(${input.permitNo?.trim() || null}, permit_no),
        permit_expires = coalesce(${input.permitExpires || null}::date, permit_expires),
        tin = coalesce(${input.tin?.trim() || null}, tin)
      where id = ${input.customerId}`,
  );
}

/** Hands an account to a CRR: by its NBD once it is ready (3rd order or day 90), or by the coach. */
export async function handOver(db: Database, me: Me, input: { customerId: number; crrId: number }): Promise<void> {
  const coach = ["team_lead", "manager"].includes(me.role) && me.channel?.code === "B2B";
  const [account] = await rows<{ nbd: number | null; handed: boolean }>(
    db,
    sql`select nbd_id::int as nbd, handed_over_at is not null as handed from b2b_account where customer_id = ${input.customerId} and dropped_at is null`,
  );
  if (!account) throw new Refusal(404, "not_found", "No such B2B account.");
  if (account.handed) throw new Refusal(409, "handed", "This account was handed over already.");
  if (!coach && account.nbd !== me.id) throw new Refusal(403, "not_allowed", "The account's NBD or the B2B coach hands it over.");
  if (!coach) {
    const [prospect] = await prospectsOf(db, [me.id], todayManila(), true).then((list) => list.filter((one) => one.customerId === input.customerId));
    if (!prospect?.ready)
      throw new Refusal(400, "not_ready", `An account goes to CRR at its ${READY_ORDERS}rd order or ${READY_DAYS} days after the first: ask your coach to hand it earlier.`);
  }
  const [crr] = await rows<{ title: string | null; role: string; code: string | null }>(
    db,
    sql`select p.title, p.role, ch.code from person p left join channel ch on ch.id = p.channel_id where p.id = ${input.crrId} and p.active`,
  );
  if (!crr || b2bRole({ role: crr.role as Me["role"], title: crr.title, channel: crr.code ? { code: crr.code, name: "", division: null } : null }) !== "crr")
    throw new Refusal(400, "invalid", "Pick a CRR to hand it to.", "crrId");
  await db.execute(
    sql`update b2b_account set crr_id = ${input.crrId}, handed_over_at = now(), handed_over_by = ${me.id}, next_call_on = null
      where customer_id = ${input.customerId}`,
  );
}

/** The B2B coach's (and the Mentor's) team now: each NBD's pipeline, each CRR's accounts. */
export async function b2bTeam(db: Database, me: Me): Promise<B2bTeam> {
  if (!["team_lead", "manager", "ceo", "admin"].includes(me.role)) throw new Refusal(403, "not_allowed", "The B2B team is the coaches' view.");
  const today = todayManila();
  const first = `${today.slice(0, 7)}-01`;
  const { seatIds } = await teamSeats(db, me, null);
  const people = seatIds.length
    ? await rows<{ personId: number; name: string; title: string | null; role: Me["role"]; areaId: number | null }>(
        db,
        sql`select distinct on (h.person_id) h.person_id::int as "personId", p.name, s.title, p.role, s.area_id::int as "areaId"
          from seat s join seat_holder h on h.seat_id = s.id and ${inForce("h", today)} join person p on p.id = h.person_id
            join org_unit u on u.id = s.unit_id left join channel ch on ch.id = u.channel_id
          where s.id in (${sql.join(seatIds.map((id) => sql`${id}`), sql`, `)}) and s.module = 'medrep' and not s.lead and ch.code = 'B2B'
          order by h.person_id, (h.kind = 'holder') desc`,
      )
    : [];
  const role = (one: (typeof people)[number]) =>
    b2bRole({ role: "medrep", title: one.title, channel: { code: "B2B", name: "", division: null } });
  const nbds = people.filter((one) => role(one) === "nbd");
  const crrs = people.filter((one) => role(one) === "crr");
  const prospects = await prospectsOf(db, nbds.map((one) => one.personId), today, true);
  const calls = nbds.length
    ? await rows<{ personId: number; calls: number; firstOrders: number }>(
        db,
        sql`select p.id::int as "personId",
            (select count(*) from account_call k where k.by_person = p.id and k.at >= ${first}::date)::int as calls,
            (select count(*) from b2b_account a where a.nbd_id = p.id
              and (select min(i.issued_on) from invoice i where i.customer_id = a.customer_id and i.status <> 'cancelled') >= ${first}::date)::int as "firstOrders"
          from person p where p.id in (${sql.join(nbds.map((one) => sql`${one.personId}`), sql`, `)})`,
      )
    : [];
  const crrRows = await Promise.all(
    crrs.map(async (one) => {
      const accounts = await accountsOf(db, [one.personId], one.areaId ? [one.areaId] : [], today);
      const last = accounts.filter((a) => a.lastMonth);
      return {
        personId: one.personId,
        name: one.name,
        accounts: accounts.filter((a) => a.state !== "lost").length,
        late: accounts.filter((a) => a.state === "late").length,
        stopped: accounts.filter((a) => a.state === "stopped").length,
        // Still ordering on time, but less than their 3-month average (late and stopped are counted apart).
        down: accounts.filter((a) => (a.state === "ok" || a.state === "due") && a.trend === "down").length,
        retention: last.length ? Math.round((last.filter((a) => a.thisMonth).length / last.length) * 100) : null,
      };
    }),
  );
  return {
    today,
    nbd: nbds.map((one) => {
      const mine = prospects.filter((p) => p.nbdId === one.personId);
      const c = calls.find((row) => row.personId === one.personId);
      return {
        personId: one.personId,
        name: one.name,
        open: mine.length,
        callsDue: mine.filter((p) => p.callDue).length,
        papersMissing: mine.filter((p) => p.missing.length && p.stage !== "ordered").length,
        ordered: mine.filter((p) => p.stage === "ordered").length,
        ready: mine.filter((p) => p.ready).length,
        flagged: mine.filter((p) => p.flagged).length,
        callsThisMonth: c?.calls ?? 0,
        firstOrdersThisMonth: c?.firstOrders ?? 0,
      };
    }),
    crr: crrRows,
    handOvers: prospects.filter((p) => p.ready || p.flagged),
    crrPeople: crrs.map((one) => ({ personId: one.personId, name: one.name })),
  };
}
