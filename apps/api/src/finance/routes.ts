// Finance's addresses. The service checks who may do what.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, idParam, readBody } from "../http";
import { tellCustomer } from "../online/tell";
import type { ConfirmPaymentInput, PaymentInput, RefundInput } from "../types";
import { financeBoard } from "./board";
import { STAFF_METHODS } from "./rules";
import {
  confirmPayment,
  customerStatement,
  customersOwe,
  invoiceDetail,
  listInvoices,
  listPayments,
  makeInvoice,
  orderOfInvoice,
  owedInvoices,
  recordPayment,
  recordRefund,
  refundsOwed,
  removePayment,
} from "./service";

const optional = (max: number) =>
  z.string().trim().max(max, `Keep it under ${max} characters.`).nullish();
const day = z.string({ error: "Pick the day." }).regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day.");
const amount = z
  .number({ error: "Type the amount." })
  .int("Type the amount in pesos and centavos.")
  .positive("Type the amount.")
  .max(100_000_000_00, "That amount is too large.");
const method = z.enum(STAFF_METHODS as [string, ...string[]], { error: "Pick how it was paid." });

const paymentInput = z.object({
  amount,
  method,
  reference: optional(80),
  paidOn: day,
  note: optional(300),
  proofId: z.number().int().positive().nullish(),
});

export function financeRoutes(
  app: Hono<Env>,
  db: Database,
  signedIn: MiddlewareHandler<Env>,
): void {
  for (const path of ["/api/finance/*", "/api/invoices/*", "/api/payments/*"])
    app.use(path, signedIn);

  app.post("/api/finance/orders/:id/confirm-payment", async (c) => {
    const input = await readBody(
      c,
      paymentInput.omit({ proofId: true }).extend({ checked: z.boolean().default(false) }),
    );
    const done = await confirmPayment(db, c.get("me"), idParam(c), input as ConfirmPaymentInput);
    void tellCustomer(db, c.get("me"), idParam(c), "confirmed");
    return c.json(done);
  });
  app.post("/api/finance/orders/:id/invoice", async (c) => {
    const input = await readBody(c, z.object({ note: optional(300) }));
    const done = await makeInvoice(db, c.get("me"), idParam(c), input);
    void tellCustomer(db, c.get("me"), idParam(c), "confirmed");
    return c.json(done);
  });

  app.get("/api/finance/board", async (c) => c.json(await financeBoard(db, c.get("me"))));

  app.get("/api/finance/owed", async (c) =>
    c.json(await customersOwe(db, c.get("me"), { q: c.req.query("q") })),
  );
  app.get("/api/finance/refunds", async (c) => c.json(await refundsOwed(db, c.get("me"))));
  app.get("/api/finance/owed/invoices", async (c) => c.json(await owedInvoices(db, c.get("me"))));
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
  app.post("/api/invoices/:id/refunds", async (c) => {
    const input = await readBody(
      c,
      z.object({ amount, method, reference: optional(80), refundedOn: day, note: optional(300) }),
    );
    await recordRefund(db, c.get("me"), idParam(c), input as RefundInput);
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
