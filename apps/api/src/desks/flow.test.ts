// The whole road with three people at Management and three at Finance (Aryan, 18 Nov: "test it
// properly: two or three people each, terms of any length, and see it reach every desk").

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { ticked } from "../testing/approve";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { DeskPerson, DeskReport, OrderBoard, OwedInvoices } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const idOf = async (name: string) =>
  (await rows<{ id: number }>(db, sql`select id::int as id from person where name = ${name}`))[0]?.id as number;

/** The login of whoever was given the order. */
const handlerOf = async (id: number, by: "manage_by" | "finance_by") => {
  const column = by === "manage_by" ? sql`o.manage_by` : sql`o.finance_by`;
  const [row] = await rows<{ name: string }>(
    db,
    sql`select p.name from sales_order o join person p on p.id = ${column} where o.id = ${id}`,
  );
  return (row?.name ?? "").toLowerCase();
};

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  // Two more at Management and two more at Finance, with the demo password.
  for (const [name, role] of [
    ["Kate", "management"],
    ["Veronica", "management"],
    ["Fred", "finance"],
    ["Gina", "finance"],
  ] as const)
    await db.execute(
      sql`insert into person (name, email, role, title, password_hash, active)
        select ${name}, ${`${name.toLowerCase()}@2mg.test`}, ${role}, 'Desk', password_hash, true from person where name = 'Sarla'`,
    );
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["sarla", "kate", "veronica", "fiona", "fred", "gina", "ryan"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("three at Management, three at Finance, terms of any length", () => {
  it("shares, approves and checks in each person's name, and the terms reach every desk", async () => {
    const customer = (await (
      await post("sarla", "/api/customers", { kind: "hospital", name: "Terms Hospital", city: "Pasay" })
    ).json()) as { id: number };
    const [medicine] = await rows<{ id: number }>(
      db,
      sql`select m.id::int as id from medicine m join medicine_price p on p.medicine_id = m.id and p.buyer_type = 'hospital' limit 1`,
    );
    // 50 days from Manila's today, as the server counts (not UTC's: they differ for 8 hours a day).
    const later = addDays(todayManila(), 50);
    // The MedRep says how the customer pays: from the list, any number of days, months, a date, COD.
    const asked = ["NET 30", "75 days", "3 months", `Pays by ${later}`, "COD", "120 Day"];
    const orders: number[] = [];
    for (const paymentTerm of asked) {
      const response = await post("ryan", "/api/orders", {
        customerId: customer.id,
        items: [{ medicineId: medicine?.id, qty: 2, priceKind: "hospital" }],
        paymentTerm,
      });
      expect(response.status, await response.clone().text()).toBe(200);
      orders.push(((await response.json()) as { id: number }).id);
    }
    const stored = await rows<{ id: number; terms: string; days: number | null; payBy: string | null }>(
      db,
      sql`select id::int as id, payment_terms as terms, payment_days::int as days, to_char(pay_by, 'YYYY-MM-DD') as "payBy"
        from sales_order where id in (${sql.join(orders.map((one) => sql`${one}`), sql`, `)}) order by id`,
    );
    expect(stored.map((one) => [one.terms, one.days, one.payBy])).toEqual([
      ["days", 30, null],
      ["days", 75, null],
      ["days", 90, null],
      ["days", 50, later],
      ["cod", null, null],
      ["days", 120, null],
    ]);

    // Nobody started yet: nobody has them. All three start, each on their own login.
    for (const name of ["Sarla", "Kate", "Veronica"])
      expect((await post(name.toLowerCase(), `/api/desk/management/people/${await idOf(name)}/start`, { on: true })).status).toBe(200);
    const owners = await rows<{ name: string; n: number }>(
      db,
      sql`select p.name, count(*)::int as n from sales_order o join person p on p.id = o.manage_by
        where o.id in (${sql.join(orders.map((one) => sql`${one}`), sql`, `)}) group by p.name order by p.name`,
    );
    expect(owners).toEqual([
      { name: "Kate", n: 2 },
      { name: "Sarla", n: 2 },
      { name: "Veronica", n: 2 },
    ]);
    // The cards say the terms as agreed.
    const board = await read<OrderBoard>("sarla", "/api/orders/board?tab=needs&desk=management");
    const card = (id: number) => board.cards.find((one) => one.id === id);
    expect(card(orders[1] as number)).toMatchObject({ paymentDays: 75 });
    expect(card(orders[3] as number)).toMatchObject({ payBy: later });

    // Finance's three start too; each order is approved by its person, on their own login.
    for (const name of ["Fiona", "Fred", "Gina"])
      expect((await post(name.toLowerCase(), `/api/desk/finance/people/${await idOf(name)}/start`, { on: true })).status).toBe(200);
    for (const id of orders) {
      const response = await post(await handlerOf(id, "manage_by"), await ticked(db, `/api/orders/${id}/approve`));
      expect(response.status, await response.clone().text()).toBe(200);
    }
    const approved = await rows<{ owner: string; approver: string }>(
      db,
      sql`select m.name as owner, a.name as approver from sales_order o join person m on m.id = o.manage_by join person a on a.id = o.approved_by
        where o.id in (${sql.join(orders.map((one) => sql`${one}`), sql`, `)})`,
    );
    for (const one of approved) expect(one.approver).toBe(one.owner);

    // At Finance: shared among the three; the invoice is due by the date agreed.
    const atFinance = await rows<{ name: string; n: number }>(
      db,
      sql`select p.name, count(*)::int as n from sales_order o join person p on p.id = o.finance_by
        where o.id in (${sql.join(orders.map((one) => sql`${one}`), sql`, `)}) group by p.name order by p.name`,
    );
    expect(atFinance).toEqual([
      { name: "Fiona", n: 2 },
      { name: "Fred", n: 2 },
      { name: "Gina", n: 2 },
    ]);
    const [byDate] = await rows<{ due: string }>(
      db,
      sql`select to_char(due_on, 'YYYY-MM-DD') as due from invoice where order_id = ${orders[3] as number}`,
    );
    expect(byDate?.due).toBe(later);

    // Finance lets them go, each on their own login.
    for (const id of orders) {
      const response = await post(await handlerOf(id, "finance_by"), `/api/finance/orders/${id}/invoice`, {});
      expect(response.status, await response.clone().text()).toBe(200);
    }
    const checked = await rows<{ owner: string; checker: string }>(
      db,
      sql`select f.name as owner, k.name as checker from sales_order o join person f on f.id = o.finance_by join person k on k.id = o.finance_checked_by
        where o.id in (${sql.join(orders.map((one) => sql`${one}`), sql`, `)})`,
    );
    for (const one of checked) expect(one.checker).toBe(one.owner);

    // Due payments: one group per terms, the date's apart.
    const owed = await read<OwedInvoices>("fiona", "/api/finance/owed/invoices");
    const termsOf = (id: number) => owed.rows.find((row) => row.orderId === id)?.terms;
    expect(orders.map(termsOf)).toEqual(["30 days", "75 days", "90 days", "By a date", "COD", "120 days"]);
    expect(owed.rows.find((row) => row.orderId === orders[3])?.dueOn).toBe(later);

    // Each person's figures and page: two approved each, in their own name.
    const report = await read<DeskReport>("sarla", "/api/desk/management/report");
    for (const name of ["Sarla", "Kate", "Veronica"])
      expect(report.people.find((one) => one.name === name)).toMatchObject({ done: 2, given: 2, open: 0 });
    const kate = await read<DeskPerson>("sarla", `/api/desk/management/people/${await idOf("Kate")}`);
    expect(kate.done.map((one) => one.outcome)).toEqual(["done", "done"]);
    expect(kate.figures.done).toBe(2);
    const finance = await read<DeskReport>("fiona", "/api/desk/finance/report");
    for (const name of ["Fiona", "Fred", "Gina"])
      expect(finance.people.find((one) => one.name === name)).toMatchObject({ done: 2, given: 2 });

    // Veronica stops: a new order goes to Sarla or Kate only.
    await post("sarla", `/api/desk/management/people/${await idOf("Veronica")}/start`, { on: false });
    const next = (await (
      await post("ryan", "/api/orders", {
        customerId: customer.id,
        items: [{ medicineId: medicine?.id, qty: 1, priceKind: "hospital" }],
        paymentTerm: "45 Day",
      })
    ).json()) as { id: number };
    const [given] = await rows<{ name: string }>(
      db,
      sql`select p.name from sales_order o join person p on p.id = o.manage_by where o.id = ${next.id}`,
    );
    expect(["Sarla", "Kate"]).toContain(given?.name);
  });
});
