// Demo data for the live CRM's walkthrough (Aryan, 19 Nov: "tomorrow I demo every part of it; the
// people real, the data dummy or a little; all of Zoho's once the server is set up"). The people
// are the real ones (the November sheet); the customers are real names read from a local copy of
// Zoho's (two per area, the area's best buyers this year, no patients); the orders are made the way
// people make them, through the app itself as the real people: the area's MedRep places it,
// Management approves, Finance invoices and takes payments, Dispatch packs, ships and delivers with
// a signed receipt; so every desk, report and dashboard has something, at every step.
//
// Every customer it makes says so in its note ("Demo · 20 Nov walkthrough"), and its orders are
// theirs, so all of it can be found and closed (cancelled, archived; nothing deleted) before the
// real go-live. Its
// stock comes off the shelf like any order's. Safe to run again: a customer already here is used,
// an area that already has its demo orders is skipped. Dry run by default; --apply writes.
//
//   SOURCE_PGLITE_DIR=<a local copy holding Zoho's customers>
//   TEST_PGLITE_DIR=<a local database to try it on> npx tsx scripts/demo-live.ts [--apply]
//   (the live database: --live, on Aryan's word: 19 Nov "put data, push to live")

import { sql } from "drizzle-orm";
import { createApp } from "../src/app";
import { startSession } from "../src/auth/sessions";
import { type Database, openDatabase, rows } from "../src/db/index";
import { migrate } from "../src/db/migrate";
import { todayManila } from "../src/inventory/rules";

const apply = process.argv.includes("--apply");
const live = process.argv.includes("--live");
if (!process.env.TEST_PGLITE_DIR && !live) throw new Error("Give TEST_PGLITE_DIR (a local database), or --live on Aryan's word.");
if (!process.env.SOURCE_PGLITE_DIR) throw new Error("Give SOURCE_PGLITE_DIR: a local copy holding Zoho's customers (the names).");
const db: Database = openDatabase(live ? { url: process.env.DATABASE_URL } : { dir: process.env.TEST_PGLITE_DIR as string });
const source: Database = openDatabase({ dir: process.env.SOURCE_PGLITE_DIR });
await migrate(db);
const MARK = "Demo · 20 Nov walkthrough";
const today = todayManila();

/** Each area's two customers and the orders they get, by the step each order is left at. */
type Step = "management" | "finance" | "invoiced" | "packing" | "shipped" | "delivered" | "paid" | "part" | "sent_back" | "held";
const PLAN: { area: string; orders: [0 | 1, Step][] }[] = [
  { area: "HOS | PASAY", orders: [[0, "paid"], [0, "shipped"], [1, "management"]] },
  { area: "HOS | COMMONWEALTH", orders: [[0, "part"], [1, "finance"]] },
  { area: "HOS | LAGUNA", orders: [[0, "packing"], [1, "management"], [0, "held"]] },
  { area: "HOS | BAGUIO", orders: [[0, "delivered"], [1, "invoiced"]] },
  { area: "HOS | DAVAO NORTH", orders: [[0, "sent_back"], [1, "paid"]] },
  { area: "HOS | NORTH CEBU", orders: [[0, "management"], [1, "invoiced"]] },
  { area: "RX | NCR 1", orders: [[0, "paid"], [1, "management"]] },
  { area: "RX | Blood & Bone Care | Marwin Dy", orders: [[0, "finance"], [1, "shipped"]] },
  { area: "B2B | Fritzie Rosann Mier", orders: [[0, "part"], [1, "management"], [0, "invoiced"]] },
  { area: "B2B | LONIE", orders: [[0, "paid"], [1, "packing"]] },
  { area: "BID | HAZEL", orders: [[0, "invoiced"], [1, "management"]] },
  { area: "CLIDP | Annie Maglatang", orders: [[0, "paid"], [1, "management"]] },
  { area: "TeleSales | Micah Jimena", orders: [[0, "finance"], [1, "delivered"]] },
];
const PRICE_KIND: Record<string, string> = { hospital: "hospital", government: "hospital", doctor: "doctor", distributor: "distributor", drugstore: "drugstore", bidding: "hospital" };

// ---- Who does each step: the real people of each desk. ----
const app = createApp(db, { webUrl: "http://localhost:5180" });
const made: number[] = [];
async function cookieOf(name: string, role?: string): Promise<string> {
  const [found] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from person where active and ${role ? sql`role = ${role}` : sql`name = ${name}`} ${role ? sql`and name = ${name}` : sql``} order by id limit 1`,
  );
  if (!found) throw new Error(`${name} is not in this database.`);
  const token = await startSession(db, found.id);
  const [session] = await rows<{ id: number }>(db, sql`select id::int as id from session where person_id = ${found.id} order by id desc limit 1`);
  if (session) made.push(session.id);
  return `sid=${token}`;
}
const call = async (cookie: string, path: string, body?: unknown, method = "POST") => {
  const response = await app.request(path, {
    method,
    headers: { cookie, ...(body instanceof FormData ? {} : { "content-type": "application/json" }) },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text.slice(0, 200)}`);
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
};
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));

// ---- The customers: real names, from Zoho's (a local copy). ----
const names = new Map<string, { name: string; kind: string; city: string | null }[]>();
for (const { area } of PLAN) {
  const best = await rows<{ name: string; kind: string; city: string | null }>(
    source,
    sql`select c.name, c.kind, c.city from customer c join area a on a.id = c.area_id
      where a.name = ${area} and c.active and c.kind <> 'patient'
      order by (select coalesce(sum(s.total), 0) from sale_invoice s where s.customer_id = c.id and s.issued_on >= '2026-01-01') desc, c.id
      limit 2`,
  );
  names.set(area, best);
}

// ---- The medicines each order takes: in stock on the main shelf, with a price for the buyer. ----
const stocked = await rows<{ id: number; name: string; kind: string; free: number }>(
  db,
  sql`select m.id::int as id, m.name, p.buyer_type as kind,
      -- The smallest batch on the main shelf: packing picks a batch, and each must hold the order.
      (select coalesce(min(st.qty), 0) from stock st join batch b on b.id = st.batch_id join warehouse w on w.id = st.warehouse_id and w.is_default
        where b.medicine_id = m.id and st.qty > 0 and (b.expires_on is null or b.expires_on > ${today}::date + 30))::int as free
    from medicine m join medicine_price p on p.medicine_id = m.id and p.amount > 0
    where m.active order by m.name`,
);
let turn = 0;
const pick = (kind: string, n: number) => {
  const fit = stocked.filter((one) => one.kind === kind && one.free >= 25);
  const out: { medicineId: number; qty: number; priceKind: string }[] = [];
  for (let i = 0; i < n && fit.length; i++) {
    const one = fit[(turn++ * 7) % fit.length] as (typeof fit)[number];
    if (!out.some((line) => line.medicineId === one.id)) out.push({ medicineId: one.id, qty: 2 + ((turn * 3) % 9), priceKind: kind });
  }
  return out;
};

console.log(`${PLAN.reduce((n, one) => n + one.orders.length, 0)} demo orders in ${PLAN.length} areas, ${stocked.filter((one) => one.free >= 25).length / 5} medicines in stock with prices`);
const management = await cookieOf("Kate Cagoyong", "management");
const finance = await cookieOf("Sarla Devi", "finance");
const dispatch = await cookieOf("Tiara Evangelista", "dispatch");

for (const { area, orders } of PLAN) {
  const [seat] = await rows<{ areaId: number; holder: string | null }>(
    db,
    sql`select a.id::int as "areaId", (select p.name from seat s join seat_holder h on h.seat_id = s.id and h.kind = 'holder' and h.ends_on is null
        join person p on p.id = h.person_id and p.active where s.area_id = a.id and s.active limit 1) as holder
      from area a where a.name = ${area}`,
  );
  const people = names.get(area) ?? [];
  if (!seat?.holder || people.length < 2) {
    console.log(`${area}: skipped (${!seat ? "no such area" : !seat.holder ? "nobody in its seat" : "fewer than two customers in the copy"})`);
    continue;
  }
  const [already] = await rows<{ n: number }>(
    db,
    sql`select count(*)::int as n from sales_order o join customer c on c.id = o.customer_id where c.area_id = ${seat.areaId} and c.note = ${MARK}`,
  );
  if (already?.n) {
    console.log(`${area}: has its demo orders already`);
    continue;
  }
  console.log(`${area} · ${seat.holder}: ${people.map((one) => `${one.name} (${one.kind})`).join(", ")} · ${orders.map(([, step]) => step).join(", ")}`);
  if (!apply) continue;
  const medrep = await cookieOf(seat.holder);
  const ids: number[] = [];
  for (const one of people) {
    const [found] = await rows<{ id: number }>(db, sql`select id::int as id from customer where lower(name) = lower(${one.name}) order by id limit 1`);
    const id =
      found?.id ??
      ((await call(management, "/api/customers", { kind: one.kind, name: one.name, city: one.city ?? undefined, areaId: seat.areaId, note: MARK, paymentTerms: "days", paymentDays: 30 })).id as number);
    // 30 days' credit, so each order goes the credit road (invoiced at Finance, paid later).
    await call(management, `/api/customers/${id}/credit`, { paymentTerms: "days", paymentDays: 30, creditLimit: null }).catch((error) =>
      console.log(`  ${one.name}: credit not set (${error instanceof Error ? error.message : String(error)})`),
    );
    ids.push(id);
  }
  for (const [which, step] of orders) {
    const customerId = ids[which] as number;
    const kind = PRICE_KIND[people[which]?.kind ?? "hospital"] ?? "hospital";
    const items = pick(kind, step === "paid" || step === "delivered" ? 2 : 1);
    if (!items.length) {
      console.log(`  no medicine in stock for ${kind}`);
      continue;
    }
    try {
      const order = (await call(medrep, "/api/orders", { customerId, items })).id as number;
      if (step === "management") continue;
      if (step === "sent_back") {
        await call(management, `/api/orders/${order}/send_back`, { reason: "Which ward receives it? Put it on the order." });
        continue;
      }
      if (step === "held") {
        await call(management, `/api/orders/${order}/hold`, { reason: "Price below the list: waiting for the head's word" });
        continue;
      }
      await call(management, `/api/orders/${order}/approve`, {});
      if (step === "finance") continue;
      await call(finance, `/api/finance/orders/${order}/invoice`, {});
      if (step === "invoiced") continue;
      await call(dispatch, `/api/dispatch/orders/${order}/pack`, {});
      if (step === "packing") continue;
      await call(dispatch, `/api/dispatch/orders/${order}/ship`, { method: "rider", rider: "Company rider", addressChecked: true });
      if (step === "shipped") continue;
      const form = new FormData();
      form.set("kind", "dr");
      form.set("file", new File([PNG], "signed-dr.png", { type: "image/png" }));
      await call(dispatch, `/api/orders/${order}/papers`, form);
      await call(dispatch, `/api/dispatch/orders/${order}/deliver`, { receivedBy: "Pharmacy receiving", deliveredOn: today });
      if (step === "delivered") continue;
      const [invoice] = await rows<{ id: number; total: number }>(db, sql`select id::int as id, total::float8 as total from invoice where order_id = ${order} and status <> 'cancelled' limit 1`);
      if (invoice)
        await call(finance, `/api/invoices/${invoice.id}/payments`, {
          amount: step === "part" ? Math.floor(invoice.total / 2) : invoice.total,
          method: "bank",
          reference: `DEMO-${order}`,
          paidOn: today,
        });
    } catch (error) {
      console.log(`  ${step}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// ---- Some that need a look (Aryan, 19 Nov: "all show blue; put some wrong"): a price below the
// list, more than the shelf holds, an expired licence, over the credit limit, advance pay with no
// proof at Finance, a MedRep's note, and new customers a MedRep added for Management to check. ----
const [extras] = await rows<{ n: number }>(db, sql`select count(*)::int as n from customer where note = ${MARK} and review = 'to_review'`);
if (extras?.n) console.log("\nThe ones that need a look: there already");
else {
  console.log("\nThe ones that need a look: a price below list, short stock, an expired licence, over the credit limit, no payment proof, a MedRep's note, 3 new customers to check");
  if (apply) {
    // Earlier runs put the mark on each order's note, where it read as the customer's remarks.
    await db.execute(sql`update sales_order set note = null where note = ${MARK}`);
    const customerOf = async (area: string, at: 0 | 1) => {
      const one = names.get(area)?.[at];
      if (!one) return null;
      const [found] = await rows<{ id: number; kind: string; city: string | null; areaId: number }>(
        db,
        sql`select id::int as id, kind, city, area_id::int as "areaId" from customer where lower(name) = lower(${one.name}) order by id limit 1`,
      );
      return found ? { ...found, name: one.name } : null;
    };
    const holderOf = async (area: string) =>
      (
        await rows<{ name: string }>(
          db,
          sql`select p.name from area a join seat s on s.area_id = a.id and s.active join seat_holder h on h.seat_id = s.id and h.kind = 'holder' and h.ends_on is null
            join person p on p.id = h.person_id where a.name = ${area} limit 1`,
        )
      )[0]?.name;
    const tryIt = async (what: string, work: () => Promise<unknown>) => {
      try {
        await work();
        console.log(`  ${what}: made`);
      } catch (error) {
        console.log(`  ${what}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    const priced = async (customerId: number, kind: string) => {
      const [line] = pick(kind, 1);
      if (!line) throw new Error(`no medicine in stock for ${kind}`);
      return line;
    };
    // 1 · A price below the buyer's list, with the MedRep's reason.
    const pasay = await customerOf("HOS | PASAY", 0);
    if (pasay)
      await tryIt("price below list (Pasay)", async () => {
        const line = await priced(pasay.id, "hospital");
        const [list] = await rows<{ amount: number }>(db, sql`select amount::float8 as amount from medicine_price where medicine_id = ${line.medicineId} and buyer_type = 'hospital'`);
        await call(await cookieOf((await holderOf("HOS | PASAY")) as string), "/api/orders", {
          customerId: pasay.id,
          items: [{ ...line, qty: 10, unitPrice: Math.round(((list?.amount ?? 0) * 0.85) / 100) * 100, reason: "Matched the price of their last order" }],
        });
      });
    // 2 · More than the shelf holds.
    const laguna = await customerOf("HOS | LAGUNA", 0);
    if (laguna)
      await tryIt("short stock (Laguna)", async () => {
        const [low] = await rows<{ id: number; free: number }>(
          db,
          sql`select m.id::int as id, coalesce(sum(st.qty), 0)::int as free from medicine m join medicine_price p on p.medicine_id = m.id and p.buyer_type = 'hospital' and p.amount > 0
            left join batch b on b.medicine_id = m.id left join stock st on st.batch_id = b.id
            where m.active group by m.id having coalesce(sum(st.qty), 0) between 1 and 20 order by m.id limit 1`,
        );
        if (!low) throw new Error("no medicine nearly out");
        await call(await cookieOf((await holderOf("HOS | LAGUNA")) as string), "/api/orders", {
          customerId: laguna.id,
          items: [{ medicineId: low.id, qty: low.free + 40, priceKind: "hospital" }],
        });
      });
    // 3 · An expired licence (a distributor's LTO).
    const fritzie = await customerOf("B2B | Fritzie Rosann Mier", 1);
    if (fritzie)
      await tryIt("expired licence (B2B)", async () => {
        await call(management, `/api/customers/${fritzie.id}`, {
          kind: fritzie.kind,
          name: fritzie.name,
          city: fritzie.city ?? undefined,
          areaId: fritzie.areaId,
          note: MARK,
          licenceNo: "LTO-3000001234567",
          licenceExpires: "2026-09-30",
        });
        const line = await priced(fritzie.id, "distributor");
        await call(await cookieOf((await holderOf("B2B | Fritzie Rosann Mier")) as string), "/api/orders", { customerId: fritzie.id, items: [line] });
      });
    // 4 · Over the credit limit: one waiting at Management, one at Finance.
    const commonwealth = await customerOf("HOS | COMMONWEALTH", 0);
    if (commonwealth)
      await tryIt("over the credit limit (Commonwealth)", async () => {
        await call(management, `/api/customers/${commonwealth.id}/credit`, { paymentTerms: "days", paymentDays: 30, creditLimit: 100000 });
        const rep = await cookieOf((await holderOf("HOS | COMMONWEALTH")) as string);
        const line = await priced(commonwealth.id, "hospital");
        await call(rep, "/api/orders", { customerId: commonwealth.id, items: [{ ...line, qty: 20 }] });
        const second = (await call(rep, "/api/orders", { customerId: commonwealth.id, items: [line] })).id as number;
        await call(management, `/api/orders/${second}/approve`, {});
      });
    // 5 · Pays in advance, no proof of payment yet: at Finance.
    const lonie = await customerOf("B2B | LONIE", 1);
    if (lonie)
      await tryIt("advance pay, no proof (B2B)", async () => {
        await call(management, `/api/customers/${lonie.id}/credit`, { paymentTerms: "advance", paymentDays: null, creditLimit: null });
        const line = await priced(lonie.id, "distributor");
        const order = (await call(await cookieOf((await holderOf("B2B | LONIE")) as string), "/api/orders", { customerId: lonie.id, items: [line] })).id as number;
        await call(management, `/api/orders/${order}/approve`, {});
      });
    // 6 · A MedRep's note for Management to read.
    const marwin = await customerOf("RX | Blood & Bone Care | Marwin Dy", 0);
    if (marwin)
      await tryIt("MedRep's note (Rx)", async () => {
        const line = await priced(marwin.id, "doctor");
        await call(await cookieOf((await holderOf("RX | Blood & Bone Care | Marwin Dy")) as string), "/api/orders", {
          customerId: marwin.id,
          items: [line],
          note: "The doctor's clinic receives deliveries only before Friday noon.",
        });
      });
    // 7 · New customers a MedRep added from the field: Management checks them.
    for (const area of ["HOS | PASAY", "HOS | BAGUIO", "B2B | LONIE"]) {
      const [third] = await rows<{ name: string; kind: string; city: string | null }>(
        source,
        sql`select c.name, c.kind, c.city from customer c join area a on a.id = c.area_id
          where a.name = ${area} and c.active and c.kind <> 'patient'
          order by (select coalesce(sum(s.total), 0) from sale_invoice s where s.customer_id = c.id and s.issued_on >= '2026-01-01') desc, c.id
          offset 2 limit 1`,
      );
      const holder = await holderOf(area);
      if (!third || !holder) continue;
      await tryIt(`new customer to check (${area})`, async () =>
        call(await cookieOf(holder), "/api/customers", { kind: third.kind, name: third.name, city: third.city ?? undefined, note: MARK }),
      );
    }
  }
}

// ---- History (Aryan, 19 Nov: "no customer owes much that is long overdue"): the delivered orders
// spread over the month's days instead of all today, and four more delivered and unpaid, billed
// 45, 70, 95 and 125 days ago, so Customers owe and Collections show real ageing. Every date on
// such an order (and its invoice, steps, events, papers, payments) moves back by the same days. ----
const SHIFT: [table: string, key: string, columns: string[]][] = [
  ["sales_order", "id", ["created_at", "submitted_at", "approved_at", "updated_at", "finance_checked_at", "packed_at", "shipped_at", "delivered_on", "delivered_at", "status_since", "dispatch_by_at", "manage_by_at", "address_checked_at", "finance_by_at", "expected_on", "pay_by"]],
  ["invoice", "order_id", ["issued_on", "due_on", "at"]],
  ["order_event", "order_id", ["at"]],
  ["order_step", "order_id", ["entered_at", "left_at"]],
  ["order_file", "order_id", ["at"]],
  ["order_pick", "order_id", ["at"]],
  ["order_assignment", "order_id", ["at"]],
  ["order_version", "order_id", ["at"]],
];
async function age(orderId: number, days: number) {
  for (const [table, key, columns] of SHIFT)
    for (const column of columns)
      await db.execute(
        sql`update ${sql.raw(table)} set ${sql.raw(column)} = ${sql.raw(column)} - make_interval(days => ${days})
          where ${sql.raw(key)} = ${orderId} and ${sql.raw(column)} is not null`,
      );
  await db.execute(
    sql`update payment set paid_on = paid_on - make_interval(days => ${days}), at = at - make_interval(days => ${days})
      where invoice_id in (select id from invoice where order_id = ${orderId})`,
  );
}
// Each part looks first, so a run cut short is finished by the next one.
const [spread] = await rows<{ n: number }>(
  db,
  sql`select count(*)::int as n from invoice i join sales_order o on o.id = i.order_id join customer c on c.id = o.customer_id
    where c.note = ${MARK} and i.issued_on < ${today}::date and i.issued_on >= date_trunc('month', ${today}::date)`,
);
console.log("\nHistory: the delivered orders spread over the month; four delivered and unpaid, billed 45, 70, 95 and 125 days ago");
if (apply) {
  {
    const done = spread?.n
      ? []
      : await rows<{ id: number }>(
          db,
          sql`select o.id::int as id from sales_order o join customer c on c.id = o.customer_id where c.note = ${MARK} and o.status = 'completed' order by o.id`,
        );
    const back = Math.max(1, Number(today.slice(8, 10)) - 2);
    for (const [at, order] of done.entries()) await age(order.id, 1 + ((at * 5) % back));
    const late: [area: string, which: 0 | 1, days: number][] = [
      ["HOS | PASAY", 0, 45],
      ["HOS | BAGUIO", 0, 70],
      ["HOS | DAVAO NORTH", 1, 95],
      ["BID | HAZEL", 1, 125],
    ];
    for (const [area, which, days] of late) {
      try {
        const one = names.get(area)?.[which];
        const [customer] = one
          ? await rows<{ id: number; kind: string }>(db, sql`select id::int as id, kind from customer where lower(name) = lower(${one.name}) and note = ${MARK} limit 1`)
          : [];
        const [holder] = await rows<{ name: string }>(
          db,
          sql`select p.name from area a join seat s on s.area_id = a.id and s.active join seat_holder h on h.seat_id = s.id and h.kind = 'holder' and h.ends_on is null
            join person p on p.id = h.person_id where a.name = ${area} limit 1`,
        );
        if (!customer || !holder) throw new Error("no such customer or seat here");
        const [late] = await rows<{ n: number }>(
          db,
          sql`select count(*)::int as n from invoice i join sales_order o on o.id = i.order_id where o.customer_id = ${customer.id} and i.issued_on < ${today}::date - 30`,
        );
        if (late?.n) continue;
        const items = pick(PRICE_KIND[customer.kind] ?? "hospital", 2).map((line) => ({ ...line, qty: line.qty + 10 }));
        const order = (await call(await cookieOf(holder.name), "/api/orders", { customerId: customer.id, items })).id as number;
        await call(management, `/api/orders/${order}/approve`, {});
        await call(finance, `/api/finance/orders/${order}/invoice`, {});
        await call(dispatch, `/api/dispatch/orders/${order}/pack`, {});
        await call(dispatch, `/api/dispatch/orders/${order}/ship`, { method: "rider", rider: "Company rider", addressChecked: true });
        const form = new FormData();
        form.set("kind", "dr");
        form.set("file", new File([PNG], "signed-dr.png", { type: "image/png" }));
        await call(dispatch, `/api/orders/${order}/papers`, form);
        await call(dispatch, `/api/dispatch/orders/${order}/deliver`, { receivedBy: "Pharmacy receiving", deliveredOn: today });
        await age(order, days);
        console.log(`  ${one?.name}: delivered, unpaid, billed ${days} days ago`);
      } catch (error) {
        console.log(`  ${area}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

// The sessions this run opened are closed again.
if (made.length) await db.execute(sql`delete from session where id in (${sql.join(made.map((id) => sql`${id}`), sql`, `)})`);
const [counts] = await rows<{ orders: number; customers: number }>(
  db,
  sql`select (select count(*) from sales_order o join customer c on c.id = o.customer_id where c.note = ${MARK})::int as orders, (select count(*) from customer where note = ${MARK})::int as customers`,
);
console.log(`\n${apply ? "Applied" : "Dry run"}: ${counts?.orders ?? 0} demo orders, ${counts?.customers ?? 0} demo customers in the database.`);
process.exit(0);
