// Daily sales performance (18 Nov 2026, the B2B team's end-of-day Excel, made by hand from Zoho's
// invoice export and the Google Form): for any day or days, each salesperson's
//  1. Sales revenue: target, 110%, week by week, total, % and balance to target (VAT-exclusive:
//     each line's amount before VAT, as Zoho's "Item Total");
//  2. TLB: how many different SKUs they sold (a SKU sold again counts once);
//  3. Billing efficiency: how many different customers they billed;
//  4. Sales calls, day by day;
//  5. Each channel's sales, ranked, its share of the whole, week by week and day by day;
//  6. Daily sales by salesperson and by channel.
// Read from the invoices themselves (this ERP's and Zoho's history), never drafts or voided ones.
// Weeks are fixed: W1 = the 1st to the 7th, W2 = 8th–14th, W3 = 15th–21st, W4 = 22nd–28th, W5 the
// rest (Aryan, 18 Nov). A salesperson is the person holding the seat on the day of the sale (a Zoho
// salesperson through the seat the Admin tied them to; a sale from before the seat was filled here
// goes to its first holder); one not tied yet shows under Zoho's name.
// Totals of TLB and billing efficiency count each SKU or customer once for the whole team, as the
// team's pivots did.

import { seatsUnder } from "../org/scope";
import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import type { Me, SalesPerformance } from "../types";
import { CALLERS, visiblePeople, WHOLE } from "../calls/service";

const isDay = (value?: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Fixed weeks: the week of a day of the month. */
export const weekOf = (day: string) => Math.min(5, Math.ceil(Number(day.slice(8, 10)) / 7));
const weekKey = (day: string) => `${day.slice(0, 7)}-W${weekOf(day)}`;

/** Every sale line in the days (VAT out), with who sold it and the line it was reported under. */
export function linesSql(from: string, to: string): SQL {
  return sql`
    with line as (
      select i.issued_on as day, o.seat_id, o.medrep_id as fallback, null::text as zoho_name,
        coalesce((select s.sku from medicine_sku s where s.medicine_id = oi.medicine_id order by s.id limit 1), 'M' || oi.medicine_id) as sku,
        'C' || i.customer_id as cust,
        -- Less what came back and was credited, as the invoice's own total (22 Nov).
        round((oi.qty - coalesce((select sum(rl.qty) from sales_return_line rl join sales_return rr on rr.id = rl.return_id where rl.order_item_id = oi.id and rr.credited_at is not null and rl.outcome <> 'missing'), 0))::numeric * oi.unit_price / case when coalesce(oi.vat_then, m.vat) = 'vat12' then 1.12 else 1 end)::bigint as amount,
        coalesce(seat_report_channel(o.seat_id), (select case c.code when 'TS' then 'TELESALES' when 'ONLINE' then 'B2C' else c.code end from channel c where c.id = o.channel_id)) as channel
      from invoice i join sales_order o on o.id = i.order_id join order_item oi on oi.order_id = o.id join medicine m on m.id = oi.medicine_id
      where i.status <> 'cancelled' and i.issued_on between ${from}::date and ${to}::date
      union all
      select d.doc_date, zs.seat_id, null::bigint, coalesce(d.fields->>'Sales Person', d.fields->>'salesperson_name'),
        coalesce(nullif(l.sku, ''), 'M' || l.medicine_id, lower(l.item_name)),
        -- Zoho's own contact on the invoice (some CRM customers join two Zoho contacts).
        'Z' || lower(trim(coalesce(d.party_name, d.customer_id::text))),
        round(coalesce(l.amount, 0) * d.fx_rate)::bigint,
        coalesce(seat_report_channel(zs.seat_id),
          nullif(case upper(trim(split_part(replace(coalesce(d.fields->>'Sales Person', d.fields->>'salesperson_name', ''), ' I ', ' | '), '|', 1)))
            when 'HOS' then 'HOSP' else upper(trim(split_part(replace(coalesce(d.fields->>'Sales Person', d.fields->>'salesperson_name', ''), ' I ', ' | '), '|', 1))) end, ''))
      from book_doc d join book_line l on l.doc_id = d.id
        left join zoho_seller zs on zs.name = coalesce(d.fields->>'Sales Person', d.fields->>'salesperson_name')
      where d.kind = 'invoice' and d.zoho_id is not null and d.status not in ('draft', 'void') and d.voided_at is null
        and d.doc_date between ${from}::date and ${to}::date and coalesce(l.qty, 1) > 0
    )
    select l.day, l.sku, l.cust, l.amount, coalesce(l.channel, 'Not tagged') as channel,
      coalesce((select h.person_id from seat_holder h where h.seat_id = l.seat_id and h.kind = 'holder' and h.starts_on <= l.day
          and (h.ends_on is null or h.ends_on >= l.day) order by h.starts_on desc limit 1),
        -- A sale from before the seat was filled in this ERP (Zoho's history): its first holder after.
        (select h.person_id from seat_holder h where h.seat_id = l.seat_id and h.kind = 'holder' and h.starts_on > l.day order by h.starts_on, h.id limit 1),
        l.fallback) as person_id,
      l.zoho_name, l.seat_id
    from line l`;
}

type Row = { key: string; name: string; channel: string; personId: number | null };

export async function salesPerformance(db: Database, me: Me, asked: { from?: string | null; to?: string | null; lead?: number | null; channel?: string | null }): Promise<SalesPerformance> {
  const whole = WHOLE.includes(me.role);
  if (!whole && !CALLERS.includes(me.role)) throw new Refusal(403, "not_allowed", "Sales performance is for the people who sell and those above them.");
  const to = isDay(asked.to) ? (asked.to as string) : todayManila();
  const from = isDay(asked.from) ? (asked.from as string) : `${to.slice(0, 7)}-01`;
  if (from > to) throw new Refusal(400, "invalid", "The first day comes after the last one.", "from");
  if (shift(from, 366) < to) throw new Refusal(400, "invalid", "Pick a year at most.", "to");

  // The days and weeks shown.
  const days: string[] = [];
  for (let day = from; day <= to; day = shift(day, 1)) days.push(day);
  const multiMonth = from.slice(0, 7) !== to.slice(0, 7);
  const weeks = [...new Set(days.map(weekKey))].map((key) => {
    const inWeek = days.filter((day) => weekKey(day) === key);
    const [y, m] = key.split("-").map(Number) as [number, number];
    return { key, label: `${multiMonth ? `${MONTHS[m - 1]} ` : ""}W${key.slice(-1)}`, from: inWeek[0] as string, to: inWeek[inWeek.length - 1] as string, year: y };
  });
  const showDays = days.length <= 31;

  // Who this viewer sees: a person by their seat; a Zoho name not tied to anyone, under its line.
  const myLine = me.channel?.code ? ({ TS: "TELESALES", ONLINE: "B2C" } as Record<string, string>)[me.channel.code] ?? me.channel.code : null;
  const seenPerson = visiblePeople(me, sql`x.person_id`, asked.lead);
  const seenUntied = whole && !asked.lead ? sql`true` : ["team_lead", "manager"].includes(me.role) && myLine && !asked.lead ? sql`x.channel = ${myLine}` : sql`false`;
  const key = sql`coalesce('P' || x.person_id, 'Z' || coalesce(x.zoho_name, '(no salesperson)'))`;
  const channel = asked.channel?.trim().toUpperCase() || null;
  // A box picked on the team switch: what was sold from its seats and those under it.
  const seen = me.unit ? sql`x.seat_id in ${seatsUnder(me.unit)}` : sql`((x.person_id is not null and ${seenPerson}) or (x.person_id is null and ${seenUntied}))`;
  const base = sql`(select * from (${linesSql(from, to)}) x where ${seen}
    ${channel ? sql`and x.channel = ${channel}` : sql``}) x`;

  const weekCase = sql`case when extract(day from x.day) <= 7 then 1 when extract(day from x.day) <= 14 then 2 when extract(day from x.day) <= 21 then 3 when extract(day from x.day) <= 28 then 4 else 5 end`;
  const weekSql = sql`to_char(x.day, 'YYYY-MM') || '-W' || ${weekCase}`;
  const [byDay, distinctBy, channelDays, people] = await Promise.all([
    rows<{ key: string; day: string; amount: number; channel: string; personId: number | null; zohoName: string | null }>(
      db,
      sql`select ${key} as key, to_char(x.day, 'YYYY-MM-DD') as day, sum(x.amount)::float8 as amount, min(x.channel) as channel,
          min(x.person_id)::int as "personId", min(x.zoho_name) as "zohoName"
        from ${base} group by 1, 2`,
    ),
    // Different SKUs and customers: per person per week, per person, per week for the team, and the team.
    rows<{ key: string | null; week: string | null; skus: number; custs: number }>(
      db,
      sql`select ${key} as key, ${weekSql} as week, count(distinct x.sku)::int as skus, count(distinct x.cust)::int as custs
        from ${base} group by grouping sets ((${key}, ${weekSql}), (${key}), (${weekSql}), ())`,
    ),
    rows<{ channel: string; day: string; amount: number }>(
      db,
      sql`select x.channel, to_char(x.day, 'YYYY-MM-DD') as day, sum(x.amount)::float8 as amount from ${base} group by 1, 2`,
    ),
    rows<{ id: number; name: string; channel: string | null }>(
      db,
      sql`select p.id::int as id, p.name,
          coalesce(seat_report_channel((select h.seat_id from seat_holder h where h.person_id = p.id and h.kind = 'holder' order by h.ends_on desc nulls first, h.starts_on desc limit 1)),
            (select case c.code when 'TS' then 'TELESALES' when 'ONLINE' then 'B2C' else c.code end from channel c where c.id = p.channel_id)) as channel
        from person p where p.active and p.role in ('medrep', 'team_lead', 'manager', 'online') and ${visiblePeople(me, sql`p.id`, asked.lead)}`,
    ),
  ]);

  const strangers = [...new Set(byDay.flatMap((line) => (line.personId && !people.some((p) => p.id === line.personId) ? [line.personId] : [])))];
  const named = new Map(
    (strangers.length
      ? await rows<{ id: number; name: string }>(db, sql`select id::int as id, name from person where id in (${sql.join(strangers.map((id) => sql`${id}`), sql`, `)})`)
      : []
    ).map((one) => [one.id, one.name]),
  );
  // Rows: everyone in view who sells (even with nothing sold yet), and every key that sold.
  const rowsByKey = new Map<string, Row>();
  for (const person of people) rowsByKey.set(`P${person.id}`, { key: `P${person.id}`, name: person.name, channel: person.channel ?? "Not tagged", personId: person.id });
  for (const line of byDay)
    if (!rowsByKey.has(line.key))
      rowsByKey.set(line.key, {
        key: line.key,
        // Sold from the box by someone who sits elsewhere now (or left): their name, from the line.
        name: line.personId ? (people.find((p) => p.id === line.personId)?.name ?? named.get(line.personId) ?? `#${line.personId}`) : (line.zohoName ?? "(no salesperson)"),
        channel: line.channel,
        personId: line.personId,
      });

  // Calls, by the person who logged them.
  const callDays = await rows<{ key: string; day: string; n: number; personId: number; person: string }>(
    db,
    sql`select 'P' || k.by_person as key, to_char(k.at at time zone 'Asia/Manila', 'YYYY-MM-DD') as day, count(*)::int as n,
        k.by_person::int as "personId", min(p.name) as person
      from account_call k join person p on p.id = k.by_person
      where (k.at at time zone 'Asia/Manila')::date between ${from}::date and ${to}::date and ${visiblePeople(me, sql`k.by_person`, asked.lead)}
      group by 1, 2, 4`,
  );
  for (const call of callDays)
    if (!rowsByKey.has(call.key))
      rowsByKey.set(call.key, { key: call.key, name: call.person, channel: "Not tagged", personId: call.personId });

  // Targets of the months the days touch (summed for several months).
  const months = [...new Set(days.map((day) => `${day.slice(0, 7)}-01`))];
  const personIds = [...rowsByKey.values()].map((row) => row.personId).filter((id): id is number => Boolean(id));
  const targets = personIds.length
    ? await rows<{ personId: number; amount: number; tlb: number | null; billed: number | null }>(
        db,
        sql`select person_id::int as "personId", sum(amount)::float8 as amount, sum(tlb)::int as tlb, sum(billed)::int as billed
          from sales_target where person_id in (${sql.join(personIds.map((id) => sql`${id}`), sql`, `)})
            and month in (${sql.join(months.map((m) => sql`${m}::date`), sql`, `)}) group by person_id`,
      )
    : [];
  const targetOf = (row: Row) => targets.find((t) => t.personId === row.personId);

  const pct = (value: number, target: number | null | undefined) => (target ? Math.round((value / target) * 10000) / 100 : null);
  if (channel) for (const [k, row] of rowsByKey) if (row.channel !== channel) rowsByKey.delete(k);
  const ordered = [...rowsByKey.values()].sort((a, b) => a.channel.localeCompare(b.channel) || a.name.localeCompare(b.name));
  const sales = (row: Row, inDay: (day: string) => boolean) => byDay.filter((l) => l.key === row.key && inDay(l.day)).reduce((s, l) => s + l.amount, 0);
  const distinct = (k: string | null, week: string | null, what: "skus" | "custs") => distinctBy.find((d) => d.key === k && d.week === week)?.[what] ?? 0;

  const revenueRows = ordered.map((row) => {
    const target = targetOf(row)?.amount ?? null;
    const total = sales(row, () => true);
    return {
      key: row.key,
      name: row.name,
      channel: row.channel,
      target,
      target110: target === null ? null : Math.round(target * 1.1),
      weeks: weeks.map((w) => sales(row, (day) => weekKey(day) === w.key)),
      total,
      pct: pct(total, target),
      btd: target === null ? null : target - total,
    };
  });
  const sumOf = <T>(list: T[], pick: (one: T) => number | null) => list.reduce((s, one) => s + (pick(one) ?? 0), 0);
  const countRows = (what: "skus" | "custs", pick: "tlb" | "billed") =>
    ordered.map((row) => {
      const target = targetOf(row)?.[pick] ?? null;
      const total = distinct(row.key, null, what);
      return { key: row.key, name: row.name, channel: row.channel, target, weeks: weeks.map((w) => distinct(row.key, w.key, what)), total, pct: pct(total, target) };
    });
  const tlbRows = countRows("skus", "tlb");
  const billingRows = countRows("custs", "billed");
  const countTotal = (list: ReturnType<typeof countRows>, what: "skus" | "custs") => {
    const target = sumOf(list, (one) => one.target);
    const total = distinct(null, null, what);
    return { target: list.some((one) => one.target !== null) ? target : null, weeks: weeks.map((w) => distinct(null, w.key, what)), total, pct: pct(total, target) };
  };

  // Calls.
  const callRows = ordered
    .map((row) => {
      const mine = callDays.filter((c) => c.key === row.key);
      return {
        key: row.key,
        name: row.name,
        channel: row.channel,
        days: showDays ? days.map((day) => mine.filter((c) => c.day === day).reduce((s, c) => s + c.n, 0)) : [],
        weeks: weeks.map((w) => mine.filter((c) => weekKey(c.day) === w.key).reduce((s, c) => s + c.n, 0)),
        total: mine.reduce((s, c) => s + c.n, 0),
      };
    })
    .filter((row) => row.total > 0 || row.key.startsWith("P"));

  // Channels, ranked by sales.
  const channelNames = [...new Set(channelDays.map((c) => c.channel))];
  const grand = channelDays.reduce((s, c) => s + c.amount, 0);
  const channelRows = channelNames
    .map((channel) => {
      const mine = channelDays.filter((c) => c.channel === channel);
      const total = mine.reduce((s, c) => s + c.amount, 0);
      return {
        channel,
        weeks: weeks.map((w) => mine.filter((c) => weekKey(c.day) === w.key).reduce((s, c) => s + c.amount, 0)),
        days: showDays ? days.map((day) => mine.filter((c) => c.day === day).reduce((s, c) => s + c.amount, 0)) : [],
        total,
        share: grand ? Math.round((total / grand) * 10000) / 100 : 0,
        rank: 0,
      };
    })
    .sort((a, b) => b.total - a.total)
    .map((row, at) => ({ ...row, rank: at + 1 }));

  const dailyPeople = revenueRows
    .filter((row) => row.total !== 0)
    .map((row) => ({ key: row.key, name: row.name, channel: row.channel, days: showDays ? days.map((day) => sales(rowsByKey.get(row.key) as Row, (d) => d === day)) : [], total: row.total }))
    .sort((a, b) => b.total - a.total);

  return {
    from,
    to,
    today: todayManila(),
    weeks: weeks.map(({ key, label, from: f, to: t }) => ({ key, label, from: f, to: t })),
    days: showDays ? days : [],
    revenue: {
      rows: revenueRows,
      total: {
        target: revenueRows.some((r) => r.target !== null) ? sumOf(revenueRows, (r) => r.target) : null,
        target110: revenueRows.some((r) => r.target110 !== null) ? sumOf(revenueRows, (r) => r.target110) : null,
        weeks: weeks.map((_, at) => sumOf(revenueRows, (r) => r.weeks[at] ?? 0)),
        total: sumOf(revenueRows, (r) => r.total),
        pct: pct(sumOf(revenueRows, (r) => r.total), sumOf(revenueRows, (r) => r.target)),
        btd: revenueRows.some((r) => r.btd !== null) ? sumOf(revenueRows, (r) => r.btd) : null,
      },
    },
    tlb: { rows: tlbRows, total: countTotal(tlbRows, "skus") },
    billing: { rows: billingRows, total: countTotal(billingRows, "custs") },
    calls: {
      rows: callRows,
      total: {
        days: showDays ? days.map((_, at) => sumOf(callRows, (r) => r.days[at] ?? 0)) : [],
        weeks: weeks.map((_, at) => sumOf(callRows, (r) => r.weeks[at] ?? 0)),
        total: sumOf(callRows, (r) => r.total),
      },
    },
    channels: {
      rows: channelRows,
      total: {
        weeks: weeks.map((_, at) => sumOf(channelRows, (r) => r.weeks[at] ?? 0)),
        days: showDays ? days.map((_, at) => sumOf(channelRows, (r) => r.days[at] ?? 0)) : [],
        total: grand,
      },
    },
    daily: { people: dailyPeople },
    channel,
    scope: whole && !asked.lead ? "company" : asked.lead ? "team" : CALLERS.includes(me.role) && !["team_lead", "manager"].includes(me.role) ? "self" : "team",
  };
}
