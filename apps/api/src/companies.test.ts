// One code per company (26 Nov): 2mg = 2MG Incorporated, gpi = Getmeds Philippines Incorporated.
// Migration 0159 moves orders and invoices from the old "getmeds" to "gpi" on a live database; it
// must keep every invoice's number and let Getmeds Philippines' series go on from where it was.
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { COMPANIES, COMPANY_CODES, companyName } from "./companies";
import { openDatabase, rows } from "./db/index";
import { migrate } from "./db/migrate";
import { invoiceCode } from "./finance/rules";

describe("the group's companies", () => {
  it("two codes, each with its registered name and its invoice series", () => {
    expect(COMPANY_CODES).toEqual(["2mg", "gpi"]);
    expect(companyName("2mg")).toBe("2MG Incorporated");
    expect(companyName("gpi")).toBe("Getmeds Philippines Incorporated");
    // The series never change: invoices already out keep their numbers.
    expect(invoiceCode("2mg", 123)).toBe("2MG-SI-000123");
    expect(invoiceCode("gpi", 45)).toBe("INV-000045");
    expect(COMPANIES.gpi.short).toBe("GPI");
  });
});

describe("migration 0159 on a database made before it", () => {
  it("moves getmeds to gpi, keeps the invoice numbers, and the series goes on from the same counter", async () => {
    const db = openDatabase({ dir: "memory" });
    await migrate(db);
    // The database as it stood before 0159: the old checks, an order and its invoice under
    // "getmeds", and Getmeds Philippines' counter at 41 under its old name.
    await db.execute(sql`alter table sales_order drop constraint sales_order_invoice_from_check`);
    await db.execute(sql`alter table invoice drop constraint invoice_invoice_from_check`);
    await db.execute(sql`alter table sales_order add constraint sales_order_invoice_from_check check (invoice_from in ('2mg', 'getmeds'))`);
    await db.execute(sql`alter table invoice add constraint invoice_invoice_from_check check (invoice_from in ('2mg', 'getmeds'))`);
    await db.execute(sql`delete from counter where name = 'invoice:gpi'`);
    await db.execute(sql`insert into counter (name, value) values ('invoice:getmeds', 41)`);
    const [person] = await rows<{ id: number }>(
      db,
      sql`insert into person (name, email, password_hash, role) values ('Seller', 'seller@2mg.test', 'x', 'medrep') returning id::int as id`,
    );
    const [customer] = await rows<{ id: number }>(
      db,
      sql`insert into customer (name, kind, added_by) values ('A hospital', 'hospital', ${person?.id}) returning id::int as id`,
    );
    const [order] = await rows<{ id: number }>(
      db,
      sql`insert into sales_order (customer_id, medrep_id, raised_by, status, payment_terms, total, invoice_from)
        values (${customer?.id}, ${person?.id}, ${person?.id}, 'ready_for_dispatch', 'cod', 1000, 'getmeds') returning id::int as id`,
    );
    await db.execute(
      sql`insert into invoice (code, order_id, customer_id, invoice_from, terms, issued_on, due_on, total, exempt, by_person)
        values ('INV-000041', ${order?.id}, ${customer?.id}, 'getmeds', 'cod', current_date, current_date, 1000, 1000, ${person?.id})`,
    );

    // Migration 0159, statement by statement, as the API runs it on start.
    const file = readFileSync(new URL("../migrations/0159_company_codes.sql", import.meta.url), "utf8");
    for (const statement of file.split("--> statement-breakpoint").map((one) => one.trim()).filter(Boolean))
      // The repository's own migration file, run as db/migrate.ts runs it (never a value from outside).
      await db.execute(sql.raw(statement)); // nosemgrep

    const [after] = await rows<{ order: string; invoice: string; code: string; counters: string }>(
      db,
      sql`select (select invoice_from from sales_order where id = ${order?.id}) as order,
          (select invoice_from from invoice where order_id = ${order?.id}) as invoice,
          (select code from invoice where order_id = ${order?.id}) as code,
          (select string_agg(name || '=' || value, ',' order by name) from counter where name like 'invoice:%') as counters`,
    );
    expect(after).toEqual({ order: "gpi", invoice: "gpi", code: "INV-000041", counters: "invoice:2mg=0,invoice:gpi=41" });
    // The old code is refused from now on.
    await expect(
      db.execute(sql`update sales_order set invoice_from = 'getmeds' where id = ${order?.id}`),
    ).rejects.toThrow();
    // The next Getmeds Philippines invoice follows the last one, not a new series from 1.
    const [next] = await rows<{ value: number }>(
      db,
      sql`update counter set value = value + 1 where name = 'invoice:gpi' returning value::int as value`,
    );
    expect(invoiceCode("gpi", next?.value ?? 0)).toBe("INV-000042");
  });
});
