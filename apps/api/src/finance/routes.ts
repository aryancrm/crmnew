// Finance's addresses. The service checks who may do what.

import { sql } from "drizzle-orm";
import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import { type Database, rows } from "../db/index";
import { type Env, idParam, Refusal, readBody } from "../http";
import { saveClaim } from "../online/service";
import { tellCustomer } from "../online/tell";
import type { ConfirmPaymentInput, PaymentInput, RefundInput } from "../types";
import { financeBoard } from "./board";
import { readCustomerCredit, useCredit } from "./credit";
import { STAFF_METHODS } from "./rules";
import {
  addHoldProof,
  confirmPayment,
  customerStatement,
  customersOwe,
  HOLD_PROOF_BYTES,
  invoiceDetail,
  listInvoices,
  listPayments,
  makeInvoice,
  moneyAccounts,
  myConfirmations,
  orderOfInvoice,
  collectedLater,
  owedGlance,
  owedInvoices,
  recordPayment,
  recordRefund,
  refundsOwed,
  removePayment,
  setMoneyAccount,
  undoConfirm,
} from "./service";

const optional = (max: number) =>
  z.string().trim().max(max, `Keep it under ${max} characters.`).nullish();
const day = z.string({ error: "Pick the day." }).regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day.");
const amount = z
  .number({ error: "Type the amount." })
  .int("Type the amount in pesos and centavos.")
  .positive("Type the amount.")
  // What the amount columns hold (about 21.4 million pesos): beyond it a plain "too large".
  .max(2_147_483_647, "That amount is too large.");
const method = z.enum(STAFF_METHODS as [string, ...string[]], { error: "Pick how it was paid." });

const paymentInput = z.object({
  // Nothing in cash is allowed when tax was withheld or something deducted (a letter's shortfall let go).
  amount: z.number({ error: "Type the amount." }).int("Type the amount in pesos and centavos.").min(0, "Type the amount.").max(2_147_483_647, "That amount is too large."),
  // A guarantee letter's order: who paid this, the agency or the patient (the rest of a short letter).
  payer: z.enum(["agency", "patient"]).nullish(),
  method,
  reference: optional(80),
  paidOn: day,
  note: optional(300),
  proofId: z.number().int().positive().nullish(),
  // The bank, cash or e-wallet account it went into.
  moneyAccount: optional(120),
  // Tax the customer withheld (EWT) with its BIR Form 2307 number.
  withheld: z.number().int().min(0).nullish(),
  form2307: optional(60),
  // What the customer deducted, why, and their debit memo.
  deducted: z.number().int().min(0).nullish(),
  deductionKind: z.enum(["near_expiry", "listing_fee", "promo", "penalty", "other", "gl_waived"]).nullish(),
  deductionRef: optional(60),
});

export function financeRoutes(
  app: Hono<Env>,
  db: Database,
  signedIn: MiddlewareHandler<Env>,
): void {
  for (const path of ["/api/finance/*", "/api/invoices/*", "/api/payments/*", "/api/refunds/*"])
    app.use(path, signedIn);

  app.post("/api/finance/orders/:id/confirm-payment", async (c) => {
    const input = await readBody(
      c,
      // 0 when its invoice is paid already (an order brought back after a cancel).
      paymentInput.omit({ proofId: true }).extend({
        amount: z.number({ error: "Type the amount." }).int("Type the amount in pesos and centavos.").min(0),
        checked: z.boolean().default(false),
      }),
    );
    const done = await confirmPayment(db, c.get("me"), idParam(c), input as ConfirmPaymentInput);
    // The order was confirmed to the customer at Management's approval (sent now if it wasn't);
    // the money Finance checked is "Payment received".
    void (async () => {
      await tellCustomer(db, c.get("me"), idParam(c), "confirmed");
      if ((input as ConfirmPaymentInput).amount > 0) await tellCustomer(db, c.get("me"), idParam(c), "paid");
    })();
    return c.json(done);
  });
  app.post("/api/finance/orders/:id/undo-confirm", async (c) => {
    await undoConfirm(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });
  // A screenshot with Finance's hold (multipart, `file`).
  app.post("/api/finance/orders/:id/hold-proof", async (c) => {
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > HOLD_PROOF_BYTES + 64 * 1024)
      throw new Refusal(400, "invalid", "That image is over 10 MB.", "file");
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const file = body.file;
    if (!(file instanceof File)) throw new Refusal(400, "invalid", "Add a screenshot.", "file");
    return c.json(
      await addHoldProof(db, c.get("me"), idParam(c), {
        name: file.name,
        mime: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      }),
    );
  });
  app.get("/api/finance/my-confirmations", async (c) =>
    c.json(
      await myConfirmations(db, c.get("me"), { from: c.req.query("from"), to: c.req.query("to") }),
    ),
  );
  app.post("/api/finance/orders/:id/invoice", async (c) => {
    const input = await readBody(c, z.object({ note: optional(300) }));
    const done = await makeInvoice(db, c.get("me"), idParam(c), input);
    void tellCustomer(db, c.get("me"), idParam(c), "confirmed");
    return c.json(done);
  });

  // A guarantee letter's claim on the agency: Finance sends it after the delivery (Aryan, 22 Nov).
  app.post("/api/finance/orders/:id/gl-claim", async (c) => {
    const input = await readBody(c, z.object({ sentOn: day.nullish(), ref: optional(80) }));
    const [found] = await rows<{ id: number }>(
      db,
      sql`select id::int as id from lead where order_id = ${idParam(c)} and road = 'gl' order by id desc limit 1`,
    );
    if (!found) throw new Refusal(404, "not_found", "This order has no guarantee-letter case.");
    await saveClaim(db, c.get("me"), found.id, input);
    return c.json({ ok: true });
  });

  app.get("/api/finance/board", async (c) => c.json(await financeBoard(db, c.get("me"))));

  app.get("/api/finance/owed", async (c) =>
    c.json(await customersOwe(db, c.get("me"), { q: c.req.query("q") })),
  );
  app.get("/api/finance/refunds", async (c) => c.json(await refundsOwed(db, c.get("me"))));
  app.get("/api/finance/owed/invoices", async (c) => c.json(await owedInvoices(db, c.get("me"))));
  app.get("/api/finance/owed/glance", async (c) => c.json(await owedGlance(db, c.get("me"))));
  app.get("/api/finance/collected", async (c) =>
    c.json(await collectedLater(db, c.get("me"), Number(c.req.query("days") ?? 30) || 30)),
  );
  app.get("/api/finance/statement/:id", async (c) =>
    c.json(
      await customerStatement(db, c.get("me"), idParam(c), {
        from: c.req.query("from"),
        to: c.req.query("to"),
      }),
    ),
  );

  app.get("/api/invoices", async (c) => {
    const query = c.req.query();
    return c.json(
      await listInvoices(db, c.get("me"), {
        tab: query.tab,
        q: query.q,
        customer: Number(query.customer) || undefined,
        page: Number(query.page) || 1,
      }),
    );
  });
  app.get("/api/invoices/:id", async (c) =>
    c.json(await invoiceDetail(db, c.get("me"), idParam(c))),
  );
  app.post("/api/invoices/:id/payments", async (c) => {
    const input = await readBody(c, paymentInput);
    await recordPayment(db, c.get("me"), idParam(c), input as PaymentInput);
    void orderOfInvoice(db, idParam(c)).then((orderId) =>
      orderId ? tellCustomer(db, c.get("me"), orderId, "paid") : false,
    );
    return c.json({ ok: true });
  });
  app.get("/api/finance/money-accounts", async (c) => c.json(await moneyAccounts(db, c.get("me"))));
  for (const kind of ["payment", "refund"] as const)
    app.post(`/api/${kind}s/:id/account`, async (c) => {
      const input = await readBody(c, z.object({ moneyAccount: z.string().trim().min(1, "Pick the account.").max(120) }));
      await setMoneyAccount(db, c.get("me"), { kind, id: idParam(c) }, input.moneyAccount);
      return c.json({ ok: true });
    });
  app.post("/api/invoices/:id/refunds", async (c) => {
    const input = await readBody(
      c,
      z.object({
        amount,
        // "credit": kept as the customer's credit for their next invoice, not given back.
        method: z.enum([...STAFF_METHODS, "credit"] as unknown as [string, ...string[]], {
          error: "Pick how it was given back.",
        }),
        reference: optional(80),
        refundedOn: day,
        note: optional(300),
        moneyAccount: optional(120),
      }),
    );
    await recordRefund(db, c.get("me"), idParam(c), input as RefundInput);
    return c.json({ ok: true });
  });
  // A customer's credit, and using some of it on an invoice.
  app.get("/api/customers/:id/credit", signedIn, async (c) =>
    c.json(await readCustomerCredit(db, c.get("me"), idParam(c))),
  );
  app.post("/api/invoices/:id/credit", async (c) => {
    const input = await readBody(
      c,
      z.object({
        kind: z.enum(["zoho", "kept"]),
        sourceId: z.number().int().positive(),
        amount: z.number({ error: "Type how much." }).int().positive("Type how much."),
      }),
    );
    await useCredit(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });

  app.get("/api/payments", async (c) => {
    const query = c.req.query();
    return c.json(
      await listPayments(db, c.get("me"), {
        month: query.month,
        method: query.method,
        q: query.q,
        page: Number(query.page) || 1,
      }),
    );
  });
  app.post("/api/payments/:id/remove", async (c) => {
    const input = await readBody(c, z.object({ reason: optional(300) }));
    await removePayment(db, c.get("me"), idParam(c), input.reason ?? null);
    return c.json({ ok: true });
  });
}
