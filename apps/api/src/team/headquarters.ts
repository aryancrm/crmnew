// Headquarters (Aryan, 27 Nov: "the main thing is the Headquarter; Javed opens his screen and sees HQ
// NCL, who works in it, its data, in this hierarchy"; PLAN 255-257). Each HQ of the team in view, as
// his sheet photo lays them out: Channel → Manager → HQ · who works it · its Zoho name · what it sold
// this month · today. An HQ is a selling seat with its territory: it stays, the person in it changes,
// and its sales are the HQ's (this CRM's invoices from the seat and Zoho's under its name, without
// VAT, as My KPIs counts them). Targets are left out until it is decided where they come from.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { invoicesSql } from "../kpis/invoices";
import { sheetName } from "../sales/target-sheet";
import type { Headquarters, Me } from "../types";
import { teamSeats } from "./service";

const LEADS = ["team_lead", "manager", "ceo", "admin"];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const plain = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();

/** The HQ in a word: the territory's last part that isn't the person's own name ("RX | NCL" → NCL;
 *  "B2C | Rachelle Upao" → ON SITE). */
export function hqOf(area: string | null, person: string | null): string {
  const own = person ? plain(person) : null;
  const parts = (area ?? "")
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part && plain(part) !== own);
  return parts.length > 1 ? (parts[parts.length - 1] as string) : "ON SITE";
}

export async function headquarters(db: Database, me: Me, asked: { month?: string | null }): Promise<Headquarters> {
  if (!LEADS.includes(me.role)) throw new Refusal(403, "not_allowed", "Headquarters are the leads' view.");
  const today = todayManila();
  const month = asked.month && MONTH.test(asked.month) && asked.month <= today.slice(0, 7) ? asked.month : today.slice(0, 7);
  const first = `${month}-01`;
  const [year, number] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  const day = today < last ? today : last;
  const { seatIds } = await teamSeats(db, me, me.unit ?? null);
  const empty: Headquarters = { month, day, channels: [], sold: 0, today: 0 };
  if (!seatIds.length) return empty;
  const seats: SQL = sql.join(seatIds.map((id) => sql`${id}`), sql`, `);

  // Every selling seat with a territory: an HQ.
  const hqs = await rows<{
    seatId: number;
    unitId: number;
    unit: string;
    unitSort: number;
    area: string;
    title: string;
    personId: number | null;
    person: string | null;
    since: string | null;
    customers: number;
    manager: string | null;
  }>(
    db,
    sql`select s.id::int as "seatId", u.id::int as "unitId", u.name as unit, coalesce(u.sort, 0)::int as "unitSort", a.name as area, s.title,
        p.id::int as "personId", p.name as person, to_char(h.starts_on, 'YYYY-MM-DD') as since,
        (select count(*) from customer c where c.area_id = s.area_id and c.active)::int as customers,
        (select pe.name from seat l join seat_holder lh on lh.seat_id = l.id and lh.kind = 'holder' and lh.ends_on is null
          join person pe on pe.id = lh.person_id where l.unit_id = u.id and l.lead and l.active limit 1) as manager
      from seat s join org_unit u on u.id = s.unit_id join area a on a.id = s.area_id
        left join lateral (select x.person_id, x.starts_on from seat_holder x where x.seat_id = s.id and x.kind = 'holder'
          and x.starts_on <= ${today}::date and (x.ends_on is null or x.ends_on >= ${today}::date) order by x.starts_on desc limit 1) h on true
        left join person p on p.id = h.person_id
      where s.id in (${seats}) and s.active and not s.lead and s.module in ('medrep', 'online')`,
  );
  if (!hqs.length) return empty;
  const hqSeats = sql.join(hqs.map((one) => sql`${one.seatId}`), sql`, `);
  const [sold, before, order] = await Promise.all([
    // What each HQ sold this month and on the day (the invoices My KPIs counts, by the seat).
    rows<{ seatId: number; sold: number; today: number }>(
      db,
      sql`select x.seat_id::int as "seatId", coalesce(sum(x.net), 0)::float8 as sold,
          coalesce(sum(x.net) filter (where x.day = ${day}::date), 0)::float8 as today
        from (${invoicesSql(first, day)}) x where x.seat_id in (${hqSeats}) group by 1`,
    ),
    // Who worked each HQ before.
    rows<{ seatId: number; name: string; from: string; to: string }>(
      db,
      sql`select h.seat_id::int as "seatId", p.name, to_char(h.starts_on, 'YYYY-MM-DD') as "from", to_char(h.ends_on, 'YYYY-MM-DD') as "to"
        from seat_holder h join person p on p.id = h.person_id
        where h.seat_id in (${hqSeats}) and h.kind = 'holder' and h.ends_on is not null and h.ends_on < ${today}::date
        order by h.ends_on desc`,
    ),
    // The sheet's order of the HQs (the photo's), when the month has one.
    rows<{ zoho: string[]; sort: number }>(
      db,
      sql`select zoho_names as zoho, sort::int as sort from target_sheet_row
        where month = (select max(month) from target_sheet_row where month <= ${first}::date) order by sort`,
    ),
  ]);
  const soldBy = new Map(sold.map((one) => [one.seatId, one]));
  const rank = new Map<string, number>();
  for (const row of order) for (const name of row.zoho) if (!rank.has(sheetName(name))) rank.set(sheetName(name), row.sort);
  const rankOf = (area: string) => rank.get(sheetName(area)) ?? Number.MAX_SAFE_INTEGER;

  const channels = new Map<number, Headquarters["channels"][number]>();
  for (const one of [...hqs].sort((a, b) => a.unitSort - b.unitSort || rankOf(a.area) - rankOf(b.area) || a.area.localeCompare(b.area))) {
    const channel = channels.get(one.unitId) ?? { unitId: one.unitId, name: one.unit, manager: one.manager, hqs: [], sold: 0, today: 0 };
    const figures = soldBy.get(one.seatId);
    channel.hqs.push({
      seatId: one.seatId,
      hq: hqOf(one.area, one.person),
      zoho: one.area,
      title: one.title,
      personId: one.personId,
      person: one.person,
      since: one.since,
      customers: one.customers,
      sold: figures?.sold ?? 0,
      today: figures?.today ?? 0,
      before: before.filter((row) => row.seatId === one.seatId).map(({ name, from, to }) => ({ name, from, to })),
    });
    channel.sold += figures?.sold ?? 0;
    channel.today += figures?.today ?? 0;
    channels.set(one.unitId, channel);
  }
  const list = [...channels.values()];
  return {
    month,
    day,
    channels: list,
    sold: list.reduce((sum, one) => sum + one.sold, 0),
    today: list.reduce((sum, one) => sum + one.today, 0),
  };
}
