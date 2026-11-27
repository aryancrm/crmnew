// The books: Zoho Inventory's Sales and Purchases lists and documents.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, readBody, Refusal } from "../http";
import { afterStockIn } from "../orders/stock-wait";
import { addBookFile,
  applyCredit,
  billOrder,
  bookChoices,
  createBill,
  createPurchaseOrder,
  createVendorCredit,
  payVendor,
  receivePayment,
  receiveOrder,
  saveVendor,
  setOrderStatus,
  voidDoc,
} from "./actions";
import { accountDetail, accountList, banking } from "./accounts";
import { insight } from "./insights";
import { booksDashboard } from "./dashboard";
import { bankStatement, categorizeLine, finishReconciliation, importStatement, matchLine, reconcileView, setLineStatus, undoReconciliation } from "./bank";
import { recurringMade, setRecurringStatus, takeOverRecurring } from "./recurring";
import {
  bookLocks,
  createAccount,
  createCreditNote,
  createDeposit,
  createExpense,
  createJournal,
  createTransfer,
  ledgerChoices,
  publishJournal,
  refundCredit,
  setLock,
  unlock,
  updateAccount,
} from "./write";
import { balanceSheet, cashFlow, grossProfit, moneySummary, payablesAging, profitAndLoss, trialBalance, vatSummary } from "./statements";
import { customerDetail, customerList } from "./customers";
import { itemDetail, itemList, priceLists } from "./items";
import { bookDoc, bookFile, bookList, isBookKind, payables, vendorDetail, vendorList } from "./service";

const listAsked = (query: (name: string) => string | undefined) => ({
  view: query("view"),
  page: Number(query("page")) || 1,
  perPage: Number(query("perPage")) || 25,
  q: query("q"),
  sort: query("sort"),
  dir: query("dir"),
  party: Number(query("party")) || undefined,
  stage: query("stage"),
});

export function bookRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/books/*", signedIn);
  app.use("/api/books-choices", signedIn);
  app.use("/api/books-ledger-choices", signedIn);
  app.use("/api/books-locks", signedIn);
  app.use("/api/books-locks/*", signedIn);
  app.use("/api/books-recurring/*", signedIn);
  app.use("/api/books-bank/*", signedIn);
  bookActionRoutes(app, db);
  app.get("/api/books/dashboard", async (c) => c.json(await booksDashboard(db, c.get("me"), { year: c.req.query("year") })));
  app.get("/api/books/items", async (c) => c.json(await itemList(db, c.get("me"), listAsked((n) => c.req.query(n)))));
  app.get("/api/books/items/:id", async (c) => c.json(await itemDetail(db, c.get("me"), Number(c.req.param("id")))));
  app.get("/api/books/pricelists", async (c) => c.json(await priceLists(db, c.get("me"))));
  app.get("/api/books/customers", async (c) => c.json(await customerList(db, c.get("me"), listAsked((n) => c.req.query(n)))));
  app.get("/api/books/customers/:id", async (c) => c.json(await customerDetail(db, c.get("me"), Number(c.req.param("id")))));
  app.get("/api/books/vendors", async (c) => c.json(await vendorList(db, c.get("me"), listAsked((n) => c.req.query(n)))));
  app.get("/api/books/vendors/:id", async (c) => c.json(await vendorDetail(db, c.get("me"), Number(c.req.param("id")))));
  app.get("/api/books/files/:id", async (c) => {
    const file = await bookFile(db, c.get("me"), Number(c.req.param("id")));
    return c.body(file.bytes as Uint8Array<ArrayBuffer>, 200, {
      "content-type": file.mime,
      "content-disposition": `inline; filename="${encodeURIComponent(file.name)}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=604800, immutable",
    });
  });
  app.get("/api/books/bill/payables", async (c) => c.json(await payables(db, c.get("me"))));
  app.get("/api/books/accounts", async (c) => c.json(await accountList(db, c.get("me"), { view: c.req.query("view"), q: c.req.query("q"), asOf: c.req.query("asOf") })));
  app.get("/api/books/accounts/:id", async (c) =>
    c.json(
      await accountDetail(db, c.get("me"), Number(c.req.param("id")), {
        page: Number(c.req.query("page")) || 1,
        perPage: Number(c.req.query("perPage")) || 50,
        kind: isBookKind(c.req.query("kind") ?? "") ? c.req.query("kind") : undefined,
      }),
    ),
  );
  app.get("/api/books/banking", async (c) => c.json(await banking(db, c.get("me"))));
  // The statements (docs/ERP-PLAN.md phase 1).
  const days = (c: { req: { query: (key: string) => string | undefined } }) => ({ from: c.req.query("from"), to: c.req.query("to") });
  app.get("/api/books/reports/trial-balance", async (c) => c.json(await trialBalance(db, c.get("me"), { asOf: c.req.query("asOf") })));
  app.get("/api/books/reports/profit-and-loss", async (c) => c.json(await profitAndLoss(db, c.get("me"), days(c))));
  app.get("/api/books/reports/balance-sheet", async (c) => c.json(await balanceSheet(db, c.get("me"), { asOf: c.req.query("asOf") })));
  app.get("/api/books/reports/cash-flow", async (c) => c.json(await cashFlow(db, c.get("me"), days(c))));
  app.get("/api/books/reports/vat", async (c) => c.json(await vatSummary(db, c.get("me"), days(c))));
  app.get("/api/books/reports/payables-aging", async (c) => c.json(await payablesAging(db, c.get("me"))));
  app.get("/api/books/reports/gross-profit", async (c) => c.json(await grossProfit(db, c.get("me"), { ...days(c), by: c.req.query("by") })));
  app.get("/api/books/reports/money-summary", async (c) => c.json(await moneySummary(db, c.get("me"))));
  // The old CRM's insight reports (sales, stock, purchases, cases), each for the desks it serves.
  app.get("/api/books/insights/:key", async (c) =>
    c.json(await insight(db, c.get("me"), c.req.param("key"), { ...days(c), by: c.req.query("by") })),
  );
  app.get("/api/books/:kind", async (c) => {
    const kind = c.req.param("kind");
    if (!isBookKind(kind)) throw new Refusal(404, "not_found", "No such list.");
    return c.json(await bookList(db, c.get("me"), kind, listAsked((n) => c.req.query(n))));
  });
  app.get("/api/books/:kind/:id", async (c) => {
    const kind = c.req.param("kind");
    if (!isBookKind(kind)) throw new Refusal(404, "not_found", "No such list.");
    return c.json(await bookDoc(db, c.get("me"), kind, Number(c.req.param("id"))));
  });
}

// ------------------------------------------------------------------ making documents

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day.");
const TEXT = (max: number) => z.string().max(max).nullish();
const MONEY = z.number().int().min(0).max(100_000_000_000_00);
const line = z.object({
  medicineId: z.number().int().positive().nullish(),
  itemName: TEXT(300),
  description: TEXT(2000),
  account: TEXT(200),
  qty: z.number().positive().max(100_000_000),
  rate: z.number().min(0).max(1_000_000_000),
  taxPct: z.number().min(0).max(100).nullish(),
});
const applied = z.array(z.object({ billId: z.number().int().positive(), amount: MONEY })).max(200);

export function bookActionRoutes(app: Hono<Env>, db: Database): void {
  app.get("/api/books-choices", async (c) => c.json(await bookChoices(db, c.get("me"))));
  app.post("/api/books/vendors", async (c) => c.json(await saveVendor(db, c.get("me"), null, await readBody(c, vendor))));
  app.post("/api/books/vendors/:id", async (c) => c.json(await saveVendor(db, c.get("me"), Number(c.req.param("id")), await readBody(c, vendor))));
  app.post("/api/books/purchase_order/new", async (c) =>
    c.json(
      await createPurchaseOrder(
        db,
        c.get("me"),
        await readBody(
          c,
          z.object({
            supplierId: z.number().int().min(0),
            reference: TEXT(120),
            date: DAY,
            deliveryDate: DAY.nullish(),
            paymentTerms: TEXT(60),
            warehouseId: z.number().int().positive(),
            fxRate: z.number().positive().nullish(),
            notes: TEXT(2000),
            terms: TEXT(4000),
            issue: z.boolean(),
            lines: z.array(line).min(1).max(200),
          }),
        ),
      ),
    ),
  );
  app.post("/api/books/purchase_order/:id/status", async (c) => {
    const { to } = await readBody(c, z.object({ to: z.enum(["issued", "cancelled", "closed", "reopen"]) }));
    await setOrderStatus(db, c.get("me"), Number(c.req.param("id")), to);
    return c.json({ ok: true });
  });
  app.post("/api/books/purchase_order/:id/receive", async (c) => {
    const made = await receiveOrder(
      db,
      c.get("me"),
      Number(c.req.param("id")),
      await readBody(
        c,
        z.object({
          date: DAY,
          notes: TEXT(2000),
          warehouseId: z.number().int().positive().nullish(),
          lines: z.array(z.object({ lineId: z.number().int().positive(), qty: z.number().min(0), batchNo: TEXT(60), expiresOn: DAY.nullish() })).min(1).max(200),
        }),
      ),
    );
    await afterStockIn(db);
    return c.json(made);
  });
  const birTaxSchema = z
    .object({
      supplierOrigin: z.enum(["local", "foreign"]).nullish(),
      vatKind: z.enum(["vat", "zero", "exempt", "none"]).nullish(),
      manualVatCentavos: z.number().int().min(0).nullish(),
      purchaseType: z.enum(["services", "capital_goods", "other_goods", "importation"]).nullish(),
      atcCode: TEXT(20),
      ewtBaseCentavos: z.number().int().min(0).nullish(),
      ewtCentavos: z.number().int().min(0).nullish(),
      noWithholdingReason: z.enum(["foreign", "not_covered", "government", "exempt_charge", "other"]).nullish(),
      noWithholdingNote: TEXT(300),
      importIeirdNo: TEXT(80),
      importAssessmentDate: DAY.nullish(),
      importDutiableCentavos: z.number().int().min(0).nullish(),
      importVatCentavos: z.number().int().min(0).nullish(),
    })
    .nullish();

  const billBody = z.object({
    supplierId: z.number().int().min(0).optional(),
    number: z.string().max(120),
    reference: TEXT(120),
    date: DAY,
    dueDate: DAY.nullish(),
    paymentTerms: TEXT(60),
    fxRate: z.number().positive().nullish(),
    notes: TEXT(2000),
    orderLines: z.array(z.object({ lineId: z.number().int().positive(), qty: z.number().min(0), rate: z.number().min(0) })).max(200).optional(),
    receiveId: z.number().int().positive().nullish(),
    lines: z.array(line).max(200).optional(),
    landedOn: z.number().int().positive().nullish(),
    birTax: birTaxSchema,
  });
  app.post("/api/books/purchase_order/:id/bill", async (c) => c.json(await billOrder(db, c.get("me"), Number(c.req.param("id")), await readBody(c, billBody))));
  app.post("/api/books/bill/new", async (c) => c.json(await createBill(db, c.get("me"), await readBody(c, billBody))));
  app.post("/api/books/vendor_payment/new", async (c) =>
    c.json(
      await payVendor(
        db,
        c.get("me"),
        await readBody(
          c,
          z.object({ supplierId: z.number().int().min(0), date: DAY, amount: MONEY, mode: TEXT(60), paidThrough: TEXT(120), reference: TEXT(120), notes: TEXT(2000), bills: applied }),
        ),
      ),
    ),
  );
  app.post("/api/books/customer_payment/new", async (c) =>
    c.json(
      await receivePayment(
        db,
        c.get("me"),
        await readBody(
          c,
          z.object({ customerId: z.number().int().min(0), date: DAY, amount: MONEY, mode: TEXT(60), depositTo: TEXT(120), reference: TEXT(120), notes: TEXT(2000), invoices: applied }),
        ),
      ),
    ),
  );
  app.post("/api/books/vendor_credit/new", async (c) =>
    c.json(
      await createVendorCredit(
        db,
        c.get("me"),
        await readBody(c, z.object({ supplierId: z.number().int().min(0), date: DAY, reference: TEXT(120), notes: TEXT(2000), fxRate: z.number().positive().nullish(), lines: z.array(line).min(1).max(200) })),
      ),
    ),
  );
  app.post("/api/books/:kind/:id/apply", async (c) => {
    await applyCredit(db, c.get("me"), Number(c.req.param("id")), await readBody(c, z.object({ date: DAY, bills: applied })));
    return c.json({ ok: true });
  });
  app.post("/api/books/:kind/:id/files", async (c) => {
    if (Number(c.req.header("content-length") ?? 0) > 10 * 1024 * 1024 + 64 * 1024)
      throw new Refusal(400, "invalid", "That file is over 10 MB.", "file");
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const file = body.file;
    if (!(file instanceof File)) throw new Refusal(400, "invalid", "Attach a photo or a PDF.", "file");
    return c.json(
      await addBookFile(db, c.get("me"), Number(c.req.param("id")), { name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }),
    );
  });
  app.post("/api/books/:kind/:id/void", async (c) => {
    const { reason } = await readBody(c, z.object({ reason: z.string().max(300) }));
    await voidDoc(db, c.get("me"), Number(c.req.param("id")), reason);
    return c.json({ ok: true });
  });

  // Writing the books (docs/BOOKS-PLAN.md A and B).
  const me = (c: { get: (key: "me") => Env["Variables"]["me"] }) => c.get("me");
  const NAME = z.string().max(200);
  const CENTS = z.number().int().min(0).max(100_000_000_000_00);
  app.get("/api/books-ledger-choices", async (c) => c.json(await ledgerChoices(db, me(c))));
  app.post("/api/books/expense/new", async (c) =>
    c.json(
      await createExpense(
        db,
        me(c),
        await readBody(
          c,
          z.object({
            date: DAY,
            lines: z.array(z.object({ account: NAME, amount: CENTS, description: TEXT(2000), taxId: z.number().int().positive().nullish() })).min(1).max(50),
            taxInclusive: z.boolean(),
            paidThrough: NAME,
            supplierId: z.number().int().positive().nullish(),
            customerId: z.number().int().positive().nullish(),
            reference: TEXT(100),
            notes: TEXT(2000),
            costCentre: NAME,
            type: NAME,
            department: NAME,
            pic: NAME,
            voucher: TEXT(100),
            orNumber: TEXT(100),
            birTax: birTaxSchema,
          }),
        ),
      ),
    ),
  );
  app.post("/api/books/journal/new", async (c) =>
    c.json(
      await createJournal(
        db,
        me(c),
        await readBody(
          c,
          z.object({
            date: DAY,
            number: TEXT(60),
            reference: TEXT(100),
            notes: z.string().max(2000),
            department: NAME,
            company: NAME,
            pic: TEXT(200),
            reverseOn: DAY.nullish(),
            publish: z.boolean(),
            lines: z
              .array(z.object({ account: NAME, description: TEXT(2000), contact: TEXT(200), debit: CENTS, credit: CENTS, taxId: z.number().int().positive().nullish() }))
              .min(2)
              .max(200),
          }),
        ),
      ),
    ),
  );
  app.post("/api/books/journal/:id/publish", async (c) => {
    await publishJournal(db, me(c), Number(c.req.param("id")));
    return c.json({ ok: true });
  });
  const move = z.object({ date: DAY, from: NAME, to: NAME, amount: CENTS, reference: TEXT(100), notes: TEXT(2000), payer: TEXT(200) });
  app.post("/api/books/transfer_fund/new", async (c) => c.json(await createTransfer(db, me(c), await readBody(c, move))));
  app.post("/api/books/deposit/new", async (c) => c.json(await createDeposit(db, me(c), await readBody(c, move))));
  app.post("/api/books/credit_note/new", async (c) =>
    c.json(
      await createCreditNote(
        db,
        me(c),
        await readBody(
          c,
          z.object({
            customerId: z.number().int().positive(),
            date: DAY,
            reference: TEXT(100),
            reason: z.string().max(500),
            notes: TEXT(2000),
            lines: z
              .array(
                z.object({
                  medicineId: z.number().int().positive().nullish(),
                  itemName: TEXT(300),
                  account: TEXT(200),
                  description: TEXT(2000),
                  qty: z.number().positive().max(100_000_000),
                  rate: z.number().min(0).max(1_000_000_000),
                  taxId: z.number().int().positive().nullish(),
                }),
              )
              .min(1)
              .max(200),
          }),
        ),
      ),
    ),
  );
  app.post("/api/books/:kind/:id/refund", async (c) =>
    c.json(
      await refundCredit(
        db,
        me(c),
        Number(c.req.param("id")),
        await readBody(c, z.object({ date: DAY, amount: CENTS, from: NAME, mode: TEXT(60), reference: TEXT(100), notes: TEXT(2000) })),
      ),
    ),
  );
  const accountBody = z.object({ name: NAME, code: TEXT(40), type: z.string().max(40), parentId: z.number().int().positive().nullish(), description: TEXT(500) });
  app.post("/api/books/accounts", async (c) => c.json(await createAccount(db, me(c), await readBody(c, accountBody))));
  app.post("/api/books/accounts/:id", async (c) => {
    await updateAccount(db, me(c), Number(c.req.param("id")), await readBody(c, accountBody.partial().extend({ active: z.boolean().optional() })));
    return c.json({ ok: true });
  });
  app.post("/api/books/:kind/:id/take-over", async (c) =>
    c.json(await takeOverRecurring(db, me(c), Number(c.req.param("id")), await readBody(c, z.object({ from: DAY })))),
  );
  app.post("/api/books/:kind/:id/recurring", async (c) => {
    await setRecurringStatus(db, me(c), Number(c.req.param("id")), await readBody(c, z.object({ active: z.boolean() })));
    return c.json({ ok: true });
  });
  app.get("/api/books-recurring/:id/made", async (c) => c.json(await recurringMade(db, me(c), Number(c.req.param("id")))));
  // Bank statements and reconciliation (docs/BOOKS-PLAN.md C).
  const acct = (c: { req: { param: (name: "account") => string } }) => decodeURIComponent(c.req.param("account"));
  app.get("/api/books-bank/:account/statement", async (c) => c.json(await bankStatement(db, me(c), acct(c), { view: c.req.query("view") })));
  app.post("/api/books-bank/:account/import", async (c) =>
    c.json(
      await importStatement(
        db,
        me(c),
        acct(c),
        await readBody(
          c,
          z.object({
            fileName: TEXT(200),
            rows: z.array(z.object({ date: DAY, description: TEXT(500), reference: TEXT(200), amount: z.number().int(), zohoId: TEXT(60) })).min(1).max(5000),
          }),
        ),
      ),
    ),
  );
  app.post("/api/books-bank/line/:id/match", async (c) => {
    await matchLine(db, me(c), Number(c.req.param("id")), await readBody(c, z.object({ entryKey: z.string().max(80), recordBankCharge: z.boolean().optional() })));
    return c.json({ ok: true });
  });
  app.post("/api/books-bank/line/:id/categorize", async (c) =>
    c.json(
      await categorizeLine(
        db,
        me(c),
        Number(c.req.param("id")),
        await readBody(
          c,
          z.discriminatedUnion("as", [
            z.object({
              as: z.literal("expense"),
              expense: z.object({
                account: NAME,
                taxId: z.number().int().positive().nullish(),
                taxInclusive: z.boolean(),
                supplierId: z.number().int().positive().nullish(),
                customerId: z.number().int().positive().nullish(),
                reference: TEXT(100),
                notes: TEXT(2000),
                costCentre: NAME,
                type: NAME,
                department: NAME,
                pic: NAME,
                voucher: TEXT(100),
                orNumber: TEXT(100),
              }),
            }),
            z.object({ as: z.literal("deposit"), from: NAME, payer: TEXT(200) }),
            z.object({ as: z.literal("transfer"), other: NAME }),
          ]),
        ),
      ),
    ),
  );
  app.post("/api/books-bank/line/:id/status", async (c) => {
    await setLineStatus(db, me(c), Number(c.req.param("id")), await readBody(c, z.object({ to: z.enum(["excluded", "uncategorized"]) })));
    return c.json({ ok: true });
  });
  app.get("/api/books-bank/:account/reconcile", async (c) => c.json(await reconcileView(db, me(c), acct(c), { end: c.req.query("end") })));
  app.post("/api/books-bank/:account/reconcile", async (c) =>
    c.json(await finishReconciliation(db, me(c), acct(c), await readBody(c, z.object({ end: DAY, closing: z.number().int(), keys: z.array(z.string().max(80)).max(10000) })))),
  );
  app.post("/api/books-bank/reconciliation/:id/undo", async (c) => {
    await undoReconciliation(db, me(c), Number(c.req.param("id")));
    return c.json({ ok: true });
  });
  app.get("/api/books-locks", async (c) => c.json(await bookLocks(db, me(c))));
  app.post("/api/books-locks/:module", async (c) => {
    await setLock(db, me(c), c.req.param("module"), await readBody(c, z.object({ lockDate: DAY, reason: TEXT(300) })));
    return c.json({ ok: true });
  });
  app.post("/api/books-locks/:module/unlock", async (c) => {
    await unlock(db, me(c), c.req.param("module"), await readBody(c, z.object({ reason: z.string().max(300) })));
    return c.json({ ok: true });
  });
}

const vendor = z.object({
  name: z.string().max(200),
  company: TEXT(200),
  email: TEXT(200),
  phone: TEXT(60),
  mobile: TEXT(60),
  website: TEXT(200),
  currency: TEXT(3),
  paymentTerms: TEXT(60),
  tin: TEXT(40),
  country: TEXT(80),
  billingAddress: TEXT(600),
  shippingAddress: TEXT(600),
});
