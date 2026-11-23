// The CEO's custom report (Aryan, 22 Nov: "anything about any person, the old history too, fully
// customizable"): pick a person (those who left too), any days, and the parts to see. Every part is
// read from the tables the CRM already keeps, so nothing is counted a second way: orders placed,
// invoices (sales), money received on their orders, visits, attendance, leave, the old system's
// invoices on the seats they held, and everything they did (the audit's own list). CEO and Admin.

import { type SQL, sql } from "drizzle-orm";
import { TRAIL } from "../audit/trail";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { ROLE_LABEL, type Role } from "../people/roles";
import type { Me, PersonReport } from "../types";

export const PERSON_PARTS: { key: string; label: string }[] = [
  { key: "orders", label: "Orders placed" },
  { key: "sales", label: "Invoices (sales)" },
  { key: "money", label: "Money received" },
  { key: "visits", label: "Visits" },
  { key: "attendance", label: "Attendance" },
  { key: "leave", label: "Leave" },
  { key: "history", label: "Old system's invoices" },
  { key: "actions", label: "Everything they did" },
];
const LIMIT = 500;
type Section = PersonReport["sections"][number];
type Column = Section["columns"][number];

const isDay = (value?: string | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

export async function personReport(
  db: Database,
  me: Me,
  asked: { person?: string | null; from?: string | null; to?: string | null; parts?: string | null },
): Promise<PersonReport> {
  allow(me, ["ceo", "admin"], "read the custom report");
  const today = todayManila();
  const to = isDay(asked.to) ? asked.to : today;
  const from = isDay(asked.from) ? asked.from : `${to.slice(0, 8)}01`;
  if (from > to) throw new Refusal(400, "invalid", "The first day comes before the last.", "from");
  const people = await rows<PersonReport["people"][number]>(
    db,
    sql`select id::int as id, name, title, role, active from person order by active desc, name`,
  );
  const base = { people, parts: PERSON_PARTS, from, to };
  const id = Number(asked.person);
  if (!Number.isInteger(id) || id <= 0) return { ...base, person: null, sections: [] };
  const [who] = await rows<{ id: number; name: string; title: string | null; role: Role; active: boolean; reportsTo: string | null }>(
    db,
    sql`select p.id::int as id, p.name, p.title, p.role, p.active, b.name as "reportsTo" from person p left join person b on b.id = p.reports_to where p.id = ${id}`,
  );
  if (!who) throw new Refusal(404, "not_found", "No such person.");
  const wanted = (asked.parts ?? "").split(",").filter((key) => PERSON_PARTS.some((part) => part.key === key));
  const keys = wanted.length ? wanted : PERSON_PARTS.map((part) => part.key);
  // A timestamp's Manila day inside the days asked.
  const within = (at: SQL) => sql`(${at} at time zone 'Asia/Manila')::date between ${from}::date and ${to}::date`;
  const days = (day: SQL) => sql`${day} between ${from}::date and ${to}::date`;

  /** One part: its rows (link first, then the columns), cut at the limit, and its totals. */
  const part = async (
    key: string,
    columns: Column[],
    query: SQL,
    totals: (list: (string | number | null)[][]) => Section["totals"],
  ): Promise<Section> => {
    const found = await rows<{ link: string | null; cells: (string | number | null)[] }>(db, sql`${query} limit ${LIMIT + 1}`);
    const list = found.slice(0, LIMIT);
    const cells = list.map((row) => row.cells);
    return {
      key,
      label: PERSON_PARTS.find((one) => one.key === key)?.label ?? key,
      columns,
      rows: cells,
      links: list.map((row) => row.link),
      totals: totals(cells),
      more: found.length > LIMIT,
    };
  };
  const sum = (list: (string | number | null)[][], at: number) => list.reduce((total, row) => total + Number(row[at] ?? 0), 0);
  const text = (label: string): Column => ({ label, kind: "text" });
  const money = (label: string): Column => ({ label, kind: "money" });
  const day = (label: string): Column => ({ label, kind: "day" });
  const time = (label: string): Column => ({ label, kind: "time" });

  const makers: Record<string, () => Promise<Section>> = {
    orders: () =>
      part(
        "orders",
        [day("Placed"), text("Order"), text("Customer"), text("Status"), money("Total")],
        sql`select '/orders/' || o.id as link,
            json_build_array(to_char(o.created_at at time zone 'Asia/Manila', 'YYYY-MM-DD'), o.code, c.name, initcap(replace(o.status, '_', ' ')), o.total::bigint) as cells
          from sales_order o join customer c on c.id = o.customer_id
          where o.medrep_id = ${id} and ${within(sql`o.created_at`)} order by o.created_at desc`,
        (list) => [
          { label: "Orders", value: list.length },
          { label: "Total", value: sum(list, 4), money: true },
          { label: "Cancelled", value: list.filter((row) => row[3] === "Cancelled").length },
        ],
      ),
    sales: () =>
      part(
        "sales",
        [day("Invoiced"), text("Invoice"), text("Order"), text("Customer"), text("Status"), money("Total"), money("Paid")],
        sql`select '/invoices/' || i.id as link,
            json_build_array(to_char(i.issued_on, 'YYYY-MM-DD'), i.code, o.code, c.name, initcap(i.status), i.total::bigint, i.paid::bigint) as cells
          from invoice i join sales_order o on o.id = i.order_id join customer c on c.id = i.customer_id
          where o.medrep_id = ${id} and i.status <> 'cancelled' and ${days(sql`i.issued_on`)} order by i.issued_on desc, i.id desc`,
        (list) => [
          { label: "Invoices", value: list.length },
          { label: "Invoiced (with VAT)", value: sum(list, 5), money: true },
          { label: "Paid on them", value: sum(list, 6), money: true },
        ],
      ),
    money: () =>
      part(
        "money",
        [day("Received"), text("Invoice"), text("Customer"), text("How"), text("Recorded by"), money("Amount")],
        sql`select '/invoices/' || i.id as link,
            json_build_array(to_char(y.paid_on, 'YYYY-MM-DD'), i.code, c.name, initcap(y.method), by.name, y.amount::bigint) as cells
          from payment y join invoice i on i.id = y.invoice_id join sales_order o on o.id = i.order_id
            join customer c on c.id = i.customer_id join person by on by.id = y.by_person
          where o.medrep_id = ${id} and y.active and ${days(sql`y.paid_on`)} order by y.paid_on desc, y.id desc`,
        (list) => [
          { label: "Payments", value: list.length },
          { label: "Received on their orders", value: sum(list, 5), money: true },
        ],
      ),
    visits: () =>
      part(
        "visits",
        [day("Day"), text("Customer"), text("Status"), text("Objective")],
        sql`select null::text as link, json_build_array(to_char(v.day, 'YYYY-MM-DD'), c.name, initcap(v.status), v.objective) as cells
          from visit v join customer c on c.id = v.customer_id
          where v.person_id = ${id} and ${days(sql`v.day`)} order by v.day desc, v.id desc`,
        (list) => [
          { label: "Planned", value: list.length },
          { label: "Done", value: list.filter((row) => row[2] === "Done").length },
          { label: "Skipped", value: list.filter((row) => row[2] === "Skipped").length },
        ],
      ),
    attendance: () =>
      part(
        "attendance",
        [day("Day"), time("In"), time("Out or last seen"), text("Started by"), text("Note")],
        sql`select null::text as link,
            json_build_array(to_char(a.day, 'YYYY-MM-DD'), to_char(a.time_in at time zone 'Asia/Manila', 'HH24:MI'),
              to_char(coalesce(a.time_out, a.last_seen) at time zone 'Asia/Manila', 'HH24:MI'), replace(a.in_source, '_', ' '), a.note) as cells
          from attendance a where a.person_id = ${id} and ${days(sql`a.day`)} order by a.day desc`,
        (list) => [{ label: "Days worked", value: list.length }],
      ),
    leave: () =>
      part(
        "leave",
        [day("From"), day("To"), text("Kind"), text("Status"), text("Reason")],
        sql`select null::text as link,
            json_build_array(to_char(l.from_day, 'YYYY-MM-DD'), to_char(l.to_day, 'YYYY-MM-DD'), upper(l.kind) || case when l.half_day then ' (half day)' else '' end,
              initcap(l.status), l.reason) as cells
          from person_leave l where l.person_id = ${id} and l.from_day <= ${to}::date and l.to_day >= ${from}::date order by l.from_day desc`,
        (list) => [{ label: "Leaves", value: list.filter((row) => row[3] === "Approved").length }],
      ),
    // The old system's invoices carry a seller's name tied to a seat, not a person: shown for the
    // seats this person held, and named so (they may be an earlier holder's).
    history: () =>
      part(
        "history",
        [day("Invoiced"), text("Invoice"), text("Customer"), text("Seat"), text("Status"), money("Total")],
        sql`select null::text as link,
            json_build_array(to_char(d.doc_date, 'YYYY-MM-DD'), d.number, d.party_name, s.title,
              case when d.status = 'void' then 'Cancelled' when d.balance <= 0 then 'Paid' else 'Open' end, round(d.total * d.fx_rate)::bigint) as cells
          from book_doc d
            join zoho_seller zs on zs.name = coalesce(d.fields->>'Sales Person', d.fields->>'salesperson_name')
            join seat s on s.id = zs.seat_id
          where d.kind = 'invoice' and d.zoho_id is not null and d.status not in ('draft', 'void')
            and zs.seat_id in (select h.seat_id from seat_holder h where h.person_id = ${id})
            and ${days(sql`d.doc_date`)} order by d.doc_date desc, d.id desc`,
        (list) => [
          { label: "Invoices", value: list.length },
          { label: "Invoiced", value: sum(list, 5), money: true },
        ],
      ),
    actions: () =>
      part(
        "actions",
        [time("When"), text("Kind"), text("Record"), text("What happened")],
        sql`select t.link, json_build_array(to_char(t.at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI'), initcap(t.kind), t.record, t.what) as cells
          from ${TRAIL} where t.at is not null and t.who = ${who.name} and ${within(sql`t.at`)} order by t.at desc`,
        (list) => [{ label: "Actions", value: list.length }],
      ),
  };
  const sections: Section[] = [];
  for (const key of keys) {
    const make = makers[key];
    if (make) sections.push(await make());
  }
  return {
    ...base,
    person: { id: who.id, name: who.name, title: who.title, roleLabel: ROLE_LABEL[who.role] ?? who.role, active: who.active, reportsTo: who.reportsTo },
    sections,
  };
}
