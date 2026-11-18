import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { customerFields, importCustomerPeople } from "../books/zoho";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";
import { importZohoCustomers, importZohoInvoices, importZohoOrders, importZohoPayments } from "./import";
import { applySplit, compareNames, isTestName, nameWords, planSplits, type SplitReport, type SplitSources } from "./split";

describe("names", () => {
  it("sets aside titles, case, punctuation and a name typed twice", () => {
    expect(nameWords("Mrs. Judith Judith Torres")).toEqual(["judith", "torres"]);
    expect(nameWords("null Cecilia Cabahug")).toEqual(["cecilia", "cabahug"]);
    expect(nameWords("Ma. Violeta Abear")).toEqual(["violeta", "abear"]);
    expect(nameWords("S.N.D PHARMACY")).toEqual(["snd", "pharmacy"]);
    expect(nameWords("E & J Pharmaceuticals")).toEqual(["ej", "pharmaceuticals"]);
    expect(nameWords("Cecilia R. Cabahug")).toEqual(["cecilia", "cabahug"]);
  });

  it("takes one buyer written differently for the same", () => {
    for (const [a, b] of [
      ["Mrs. Cecilia Cabahug", "CECILIA CABAHUG"],
      ["Cecilia Cali", "Cecilia Valentin Cali"],
      ["Mr. Sir Mel", "Melchor Gingco"],
      ["Natasha Diaz", "Tasha Diaz"],
      ["Bernadette Yap-Abela", "Bernadette Abella"],
      ["Bob John Trading", "BOBJOHN TRADING"],
      ["LA FOI PHARMA AND MEDICAL SUPPLIES", "Lafoi Pharma And Medical Supplies Trading"],
      ["JLD PHIL DRUG DISTRIBUTION SERVICES", "JDL Phil Drug Distribution Services"],
      ["GOLDEN DRUGSTORE", "Golden pharmacy"],
      ["23 & Me Pharmaceutical Corporation", "23&me Pharmaceuticals Corporation"],
      ["Natrapham Incorporated", "NATRAPHARM, INC."],
    ])
      expect(compareNames(a as string, b as string).verdict, `${a} / ${b}`).toBe("same");
  });

  it("keeps names alike in part apart from clear mismatches", () => {
    for (const [a, b] of [
      ["Delia Jerusalem Coja", "Winefredo Arroyo Coja"],
      ["Rose Garcia Villagracia", "Rose Garcia Villarama"],
      ["Pride Pharma and Medical Supplies Distribution", "Primed Pharma and Medical Supplies Distribution"],
      ["Cadelan Pharma", "CALEDAN PHARMA CORP"],
      ["09127107219", "Patrick Bautista Mabazza"],
    ])
      expect(compareNames(a as string, b as string).verdict, `${a} / ${b}`).toBe("close");
    for (const [a, b] of [
      ["LOS MEDICINAS PHARMACY", "LUCKY 8 PHARMACY"],
      ["Bea Ampaso", "Test Shane"],
      ["DYNASTY PHARMACEUTICALS", "RIFEMEDICA CORPORATION"],
      ["MJ PHARMACY", "NG PHARMACY"],
      ["Marikina Pharma And Medical Supplies", "Imus Pharma & Medical Supplies"],
    ]) {
      const found = compareNames(a as string, b as string);
      expect(found.verdict, `${a} / ${b}`).toBe("different");
      expect(found.score).toBeGreaterThanOrEqual(70);
    }
    expect(compareNames("Mr. John Angeles", "John Angeles").score).toBe(0);
    expect(isTestName("Test Shane")).toBe(true);
    expect(isTestName("Testa Rossa")).toBe(false);
  });
});

describe("splitting customers joined from different Zoho contacts", () => {
  let db: Database;
  let report: SplitReport;
  const sources: SplitSources = { docContact: new Map(), contactName: new Map() };
  const customerOf = async (zohoId: string) =>
    (await rows<{ id: number }>(db, sql`select customer_id::int as id from zoho_contact where zoho_id = ${zohoId}`))[0]?.id as number;
  const count = async (table: string) => (await rows<{ n: number }>(db, sql.raw(`select count(*)::int as n from ${table}`)))[0]?.n ?? 0;

  beforeAll(async () => {
    db = openDatabase({ dir: "memory" });
    await migrate(db);
    await seedDemo(db, "test-password-1");
    // Joined by the import: two pharmacies of one owner, a test contact on a patient's number,
    // a patient typed twice, a husband and wife, two people on a carer's phone.
    const contacts = [
      { id: "z-los", name: "LOS MEDICINAS PHARMACY", business: true, mobile: "0952 471 1570", city: "Iloilo" },
      { id: "z-lucky", name: "LUCKY 8 PHARMACY", business: true, mobile: "09524711570", city: "Iloilo" },
      { id: "z-bea", name: "Bea Ampaso", business: false, mobile: "0919 076 9103" },
      { id: "z-shane", name: "Test Shane", business: false, mobile: "09190769103" },
      { id: "z-cec", name: "Mrs. Cecilia Cabahug", business: false, mobile: "0995 425 1871" },
      { id: "z-cec2", name: "CECILIA CABAHUG", business: false, mobile: "09954251871" },
      { id: "z-delia", name: "Delia Jerusalem Coja", business: false, mobile: "0908 706 7426" },
      { id: "z-wine", name: "Winefredo Arroyo Coja", business: false, mobile: "09087067426" },
      { id: "z-chan", name: "Ms. Philistina Chan", business: false, mobile: "0936 771 2275" },
      { id: "z-asun", name: "Dietricht Asuncion", business: false, mobile: "09367712275" },
    ];
    await importZohoCustomers(db, contacts, true);
    for (const one of contacts) sources.contactName.set(one.id, one.name);
    await importZohoOrders(
      db,
      [
        { id: "so-los", code: "SO-1", customerId: "z-los", date: "2026-10-01", status: "closed", total: 1000, source: "Distributor order", lines: [] },
        { id: "so-lucky", code: "SO-2", customerId: "z-lucky", date: "2026-10-02", status: "closed", total: 2000, source: "Distributor order", lines: [] },
        { id: "so-shane", code: "SO-3", customerId: "z-shane", date: "2026-10-03", status: "closed", total: 10, lines: [] },
      ],
      true,
    );
    await importZohoInvoices(
      db,
      [
        { id: "inv-los", code: "INV-1", customerId: "z-los", orderCode: "SO-1", date: "2026-10-01", status: "closed", total: 1000, balance: 0 },
        { id: "inv-lucky", code: "INV-2", customerId: "z-lucky", orderCode: "SO-2", date: "2026-10-02", status: "open", total: 2000, balance: 500 },
      ],
      true,
    );
    await importZohoPayments(
      db,
      [{ id: "pay-lucky-1", paymentNo: "7", customerId: "z-lucky", invoiceCode: "INV-2", date: "2026-10-05", amount: 1500, paymentTotal: 1500 }],
      true,
    );
    // The books: the same documents, by the name each contact had.
    const los = await customerOf("z-los");
    const doc = async (kind: string, zohoId: string, party: string, total: number, balance: number) =>
      (
        await rows<{ id: number }>(
          db,
          sql`insert into book_doc (kind, zoho_id, number, doc_date, status, customer_id, party_name, total, balance)
            values (${kind}, ${zohoId}, ${zohoId}, '2026-10-01', ${balance ? "overdue" : "paid"}, ${los}, ${party}, ${total}, ${balance}) returning id::int as id`,
        )
      )[0]?.id as number;
    await doc("invoice", "inv-los", "LOS MEDICINAS PHARMACY", 100000, 0);
    const lucky = await doc("invoice", "inv-lucky", "LUCKY 8 PHARMACY", 200000, 50000);
    const paid = await doc("customer_payment", "cp-lucky", "LUCKY 8 PHARMACY", 150000, 0);
    await db.execute(sql`insert into book_link (from_doc, to_doc, amount) values (${paid}, ${lucky}, 150000)`);
    for (const [key, contact] of [
      ["sales_order:so-los", "z-los"],
      ["sales_order:so-lucky", "z-lucky"],
      ["sales_order:so-shane", "z-shane"],
      ["invoice:inv-los", "z-los"],
      ["invoice:inv-lucky", "z-lucky"],
      ["customer_payment:cp-lucky", "z-lucky"],
      ["payment_share:pay-lucky-1", "z-lucky"],
      ["person:cp-ana", "z-lucky"],
    ] as const)
      sources.docContact.set(key, contact);
    // Each contact's Zoho record, and a contact person.
    await customerFields(
      db,
      [
        { "Contact ID": "z-los", "Display Name": "LOS MEDICINAS PHARMACY", "Customer Sub Type": "business", MobilePhone: "09524711570", "Billing City": "Iloilo", "CF.LTO License Number": "LTO-1" },
        { "Contact ID": "z-lucky", "Display Name": "LUCKY 8 PHARMACY", "Customer Sub Type": "business", "Company Name": "Lucky 8 Corp", MobilePhone: "09524711570", "Billing City": "Jaro", "CF.LTO License Number": "LTO-8", "CF.LTO Type": "Drugstore" },
      ],
      true,
    );
    await importCustomerPeople(db, [{ "Contact ID": "z-lucky", "Contact Person ID": "cp-ana", "First Name": "Ana", "Last Name": "Uy" }], true);
    report = await planSplits(db, sources);
  });

  it("joined them as the import does: one customer per phone number and kind", async () => {
    expect(await customerOf("z-lucky")).toBe(await customerOf("z-los"));
    expect(await customerOf("z-shane")).toBe(await customerOf("z-bea"));
    expect(report.joined).toBe(5);
  });

  it("lists every customer joined from different names, with how different", () => {
    const verdict = (name: string) => report.listed.find((one) => one.name === name);
    expect(verdict("LOS MEDICINAS PHARMACY")).toMatchObject({ verdict: "different" });
    expect(verdict("Mrs. Cecilia Cabahug")).toMatchObject({ verdict: "same", score: 0 });
    expect(verdict("Delia Jerusalem Coja")).toMatchObject({ verdict: "close" });
    expect(report.cases.map((one) => [one.name, one.moves.map((move) => move.kind)])).toEqual([
      ["LOS MEDICINAS PHARMACY", ["business"]],
      ["Ms. Philistina Chan", ["people"]],
      ["Bea Ampaso", ["test"]],
    ]);
  });

  it("says what moves with the contact that is someone else", () => {
    const pharmacy = report.cases.find((one) => one.name === "LOS MEDICINAS PHARMACY");
    const move = pharmacy?.moves[0];
    expect(move?.contacts.map((one) => one.name)).toEqual(["LUCKY 8 PHARMACY"]);
    expect(move?.counts).toEqual({ invoice: 1, customer_payment: 1, past_order: 1, past_invoice: 1, past_payment: 1, person: 1 });
    expect(move?.billed).toBe(200000);
    expect(move?.owed).toBe(50000);
    expect(pharmacy?.stays.counts).toEqual({ invoice: 1, past_order: 1, past_invoice: 1 });
    expect(pharmacy?.crossLinks).toBe(0);
    expect(pharmacy?.phones).toEqual(["0952 471 1570"]);
  });

  it("splits a clear mismatch into a customer of its own, deleting nothing", async () => {
    const before = await Promise.all(["customer", "zoho_contact", "book_doc", "past_order", "past_invoice", "past_payment", "customer_person"].map(count));
    const los = await customerOf("z-los");
    const [{ id: admin } = { id: 0 }] = await rows<{ id: number }>(db, sql`select id::int as id from person where role = 'admin' order by id limit 1`);
    const pharmacy = report.cases.find((one) => one.name === "LOS MEDICINAS PHARMACY");
    if (!pharmacy) throw new Error("no plan");
    const done = await applySplit(db, pharmacy, sources, admin, "2026-11-18");
    expect(done.skipped).toBeNull();
    expect(done.made).toHaveLength(1);
    const lucky = done.made[0]?.id as number;
    expect(await customerOf("z-lucky")).toBe(lucky);
    expect(await customerOf("z-los")).toBe(los);
    const [made] = await rows<Record<string, unknown>>(
      db,
      sql`select code, name, kind, zoho_id as "zohoId", city, licence_no as licence, area_id::int as area, note, zoho_fields as fields from customer where id = ${lucky}`,
    );
    expect(made).toMatchObject({ code: `CUS-${String(lucky).padStart(5, "0")}`, name: "LUCKY 8 PHARMACY", kind: "drugstore", zohoId: "z-lucky", city: "Jaro", licence: "LTO-8" });
    expect(made?.note).toContain("Split from");
    expect(made?.fields).toMatchObject({ "Display Name": "LUCKY 8 PHARMACY", "CF.LTO License Number": "LTO-8" });
    const whose = async (table: string, column = "customer_id") =>
      (await rows<{ who: number; n: number }>(db, sql.raw(`select ${column}::int as who, count(*)::int as n from ${table} where ${column} in (${los}, ${lucky}) group by 1 order by 1`))).map((row) => [row.who === los ? "los" : "lucky", row.n]);
    expect(await whose("book_doc")).toEqual([["los", 1], ["lucky", 2]]);
    expect(await whose("past_order")).toEqual([["los", 1], ["lucky", 1]]);
    expect(await whose("past_invoice")).toEqual([["los", 1], ["lucky", 1]]);
    expect(await whose("past_payment")).toEqual([["lucky", 1]]);
    expect(await whose("customer_person")).toEqual([["lucky", 1]]);
    const [kept] = await rows<{ note: string; fields: Record<string, unknown> }>(db, sql`select note, zoho_fields as fields from customer where id = ${los}`);
    expect(kept?.note).toContain(`moved to ${made?.code}`);
    expect(kept?.fields["Other Zoho records"]).toBeUndefined();
    expect(kept?.fields["CF.LTO License Number"]).toBe("LTO-1");
    const after = await Promise.all(["customer", "zoho_contact", "book_doc", "past_order", "past_invoice", "past_payment", "customer_person"].map(count));
    expect(after).toEqual([(before[0] as number) + 1, ...before.slice(1)]);
    // Done again, nothing more happens; a new plan no longer finds it.
    expect((await applySplit(db, pharmacy, sources, admin, "2026-11-18")).skipped).toBe("already split");
    const again = await planSplits(db, sources);
    expect(again.cases.map((one) => one.name)).toEqual(["Ms. Philistina Chan", "Bea Ampaso"]);
  });
});
