// Orders' addresses. Everyone signed in may ask; the service decides which orders each person
// sees and what they may do to one.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { allow, type Env, idParam, Refusal, readBody } from "../http";
import { tellAboutOrder } from "../notify/service";
import { orderPrices } from "../customers/prices";
import { customerUpdate, noteSent, tellCustomer } from "../online/tell";
import type { OrderAction, OrderDetailsInput, OrderInput, OrderRevision } from "../types";
import { companyKpis } from "./company-kpis";
import { ORDER_SOURCES } from "./divisions";
import { myKpis } from "./my-kpis";
import { ORDER_PLACE_ROLES } from "./rules";
import { salesOrderRoutes } from "./sales-order";
import {
  actOnOrder,
  addPaper,
  approvalQueue,
  handleOrder,
  listOrders,
  myOrders,
  orderBoard,
  orderDashboard,
  orderDetail,
  orderForList,
  PAPER_MAX_BYTES,
  placeOrder,
  readPaper,
  removePaper,
  reviseOrder,
  saveOrderDetails,
} from "./service";
import { tellStockBack } from "./stock-wait";

/** The bell is told after the work is saved; a failure there never undoes the work. */
export async function tellSafely(tell: () => Promise<void>): Promise<void> {
  try {
    await tell();
  } catch (problem) {
    console.error("notification not written:", problem);
  }
}

const optional = (max: number) =>
  z.string().trim().max(max, `Keep it under ${max} characters.`).nullish();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");

const orderInput = z.object({
  customerId: z.number({ error: "Pick the customer." }).int().positive("Pick the customer."),
  medrepId: z
    .number({ error: "Pick the MedRep." })
    .int()
    .positive("Pick the MedRep.")
    .nullable()
    .optional(),
  items: z
    .array(
      z.object({
        medicineId: z.number({ error: "Pick a medicine." }).int().positive("Pick a medicine."),
        qty: z
          .number({ error: "Type how many." })
          .int("Use a whole number.")
          .positive("Type how many.")
          .max(1_000_000, "That is too many."),
        priceKind: z.string().min(1, "Pick a price.").max(20),
        unitPrice: z
          .number()
          .int()
          .min(0, "Type the price.")
          .max(1_000_000_00, "That price is too high.")
          .nullish(),
        reason: optional(300),
        free: z.boolean().optional(),
      }),
    )
    .min(1, "Add at least one medicine.")
    .max(60, "That is too many lines for one order."),
  deliveryAddress: optional(300),
  receiver: optional(120),
  receiverPhone: optional(40),
  note: optional(500),
  expectedOn: date.nullish().or(z.literal("")),
  customerPo: optional(60),
  invoiceFrom: z.enum(["2mg", "getmeds"], { error: "Pick the company that bills it." }).optional(),
  doctorId: z.number().int().positive().nullish(),
  checks: z.object({ management: z.boolean(), finance: z.boolean() }).optional(),
  division: optional(40),
  subDivision: optional(60),
  paymentTerm: optional(60),
  noProofReason: z
    .enum(["on_terms", "payment_to_follow", "paid_no_slip", "other"], {
      error: "Pick why there is no proof.",
    })
    .nullish(),
  source: z.enum(ORDER_SOURCES, { error: "Pick where the order came from." }).nullish(),
  stockReason: optional(300),
  noProofNote: optional(300),
  patientOrder: z.boolean().optional(),
  patientName: optional(120),
  relief: z
    .object({
      kind: z.enum(["senior", "pwd"], { error: "Pick senior citizen or PWD." }),
      idNo: optional(40),
      name: optional(120),
    })
    .nullish(),
});

/** What Management completes on a field order. */
const detailsInput = z.object({
  division: optional(40),
  subDivision: optional(60),
  paymentTerm: optional(60),
  receiver: optional(120),
  receiverPhone: optional(40),
  deliveryAddress: optional(300),
  expectedOn: date.nullish().or(z.literal("")),
  customerPo: optional(60),
  invoiceFrom: z.enum(["2mg", "getmeds"], { error: "Pick the company that bills it." }).optional(),
  note: optional(500),
});

const ACTIONS: readonly OrderAction[] = [
  "approve",
  "send_back",
  "reject",
  "hold",
  "exception",
  "resume",
  "cancel",
  "resubmit",
  "take_back",
  "restore",
  "answer",
];

export function orderRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  for (const path of ["/api/orders/*", "/api/papers/*"]) app.use(path, signedIn);

  app.get("/api/orders", async (c) => {
    const query = c.req.query();
    const day = (value?: string) =>
      value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
    return c.json(
      await listOrders(db, c.get("me"), {
        status: query.status,
        group: query.group,
        q: query.q,
        medrep: Number(query.medrep) || undefined,
        from: day(query.from),
        to: day(query.to),
        stuck: query.stuck === "1",
        page: Number(query.page) || 1,
      }),
    );
  });

  // Before /:id, so these words are never read as an id.
  app.get("/api/orders/dashboard", async (c) => c.json(await orderDashboard(db, c.get("me"))));
  app.get("/api/orders/board", async (c) => {
    const query = c.req.query();
    return c.json(
      await orderBoard(db, c.get("me"), {
        desk: query.desk,
        tab: query.tab,
        channel: query.channel || undefined,
        medrep: Number(query.medrep) || undefined,
        q: query.q,
        status: query.status,
        shown: Number(query.shown) || 0,
      }),
    );
  });
  app.get("/api/orders/company-kpis", async (c) =>
    c.json(
      await companyKpis(db, c.get("me"), {
        period: c.req.query("period"),
        day: c.req.query("day"),
      }),
    ),
  );
  app.get("/api/orders/kpis", async (c) =>
    c.json(
      await myKpis(db, c.get("me"), { period: c.req.query("period"), day: c.req.query("day") }),
    ),
  );
  app.get("/api/orders/mine", async (c) =>
    c.json(
      await myOrders(db, c.get("me"), {
        stage: c.req.query("stage"),
        page: Number(c.req.query("page")) || 1,
        seat: Number(c.req.query("seat")) || undefined,
      }),
    ),
  );
  app.get("/api/orders/for", async (c) =>
    c.json(await orderForList(db, c.get("me"), Number(c.req.query("customerId")) || null)),
  );
  app.get("/api/orders/queue", async (c) =>
    c.json({ orders: await approvalQueue(db, c.get("me")) }),
  );

  app.get("/api/orders/:id", async (c) => c.json(await orderDetail(db, c.get("me"), idParam(c))));
  // What this customer was given before for each medicine on the order.
  app.get("/api/orders/:id/prices", async (c) =>
    c.json(await orderPrices(db, c.get("me"), idParam(c))),
  );
  salesOrderRoutes(app, db);

  app.post("/api/orders", async (c) => {
    allow(c.get("me"), ORDER_PLACE_ROLES, "place an order");
    const input = await readBody(c, orderInput);
    const id = await placeOrder(db, c.get("me"), input as OrderInput);
    void tellCustomer(db, c.get("me"), id, "confirmed");
    return c.json({ id });
  });

  // "Send to customer": the order's newest step as an email (again) and as a short text for
  // WhatsApp, Viber, SMS and Messenger.
  app.get("/api/orders/:id/update", async (c) => {
    await orderDetail(db, c.get("me"), idParam(c));
    return c.json({ update: await customerUpdate(db, idParam(c)) });
  });
  app.post("/api/orders/:id/update/email", async (c) => {
    await orderDetail(db, c.get("me"), idParam(c));
    const update = await customerUpdate(db, idParam(c));
    if (!update)
      throw new Refusal(
        409,
        "not_now",
        "There is no news to send yet: it goes once the order is confirmed.",
      );
    if (!update.email)
      throw new Refusal(
        409,
        "not_now",
        "This customer has no email. Add it on the customer (or the case) first.",
      );
    if (!(await tellCustomer(db, c.get("me"), idParam(c), update.event, true)))
      throw new Refusal(
        409,
        "not_sent",
        "The email wasn't sent: connect a mailbox under Channels.",
      );
    return c.json({ ok: true });
  });

  app.post("/api/orders/:id/update/sent", async (c) => {
    const input = await readBody(
      c,
      z.object({ via: z.enum(["whatsapp", "viber", "sms", "messenger", "copy"]) }),
    );
    await orderDetail(db, c.get("me"), idParam(c));
    await noteSent(db, c.get("me"), idParam(c), input.via);
    return c.json({ ok: true });
  });

  // A sent-back order, fixed by its MedRep and sent to Management again with their answer.
  app.post("/api/orders/:id/revise", async (c) => {
    const input = await readBody(c, orderInput.extend({ answer: z.string().max(1000) }));
    await reviseOrder(db, c.get("me"), idParam(c), input as OrderRevision);
    await tellSafely(() => tellAboutOrder(db, c.get("me"), idParam(c), "revise", null, "draft"));
    return c.json({ ok: true });
  });

  // Someone in Management says "I'll handle it" (or lets it go).
  app.post("/api/orders/:id/handle", async (c) => {
    const input = await readBody(c, z.object({ release: z.boolean().optional() }));
    await handleOrder(db, c.get("me"), idParam(c), Boolean(input.release));
    return c.json({ ok: true });
  });

  // Management changes a placed order before approving it: the same form, with why.
  app.post("/api/orders/:id/change", async (c) => {
    const input = await readBody(c, orderInput.extend({ answer: z.string().max(1000) }));
    await reviseOrder(db, c.get("me"), idParam(c), input as OrderRevision, "management");
    return c.json({ ok: true });
  });

  app.post("/api/orders/:id/details", async (c) => {
    const input = await readBody(c, detailsInput);
    await saveOrderDetails(db, c.get("me"), idParam(c), input as OrderDetailsInput);
    return c.json({ ok: true });
  });

  // A photo or PDF on an order: multipart, with `file` and `kind`.
  app.post("/api/orders/:id/papers", async (c) => {
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > PAPER_MAX_BYTES + 64 * 1024)
      throw new Refusal(400, "invalid", "That file is over 10 MB. Take the photo again.", "file");
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const file = body.file;
    if (!(file instanceof File))
      throw new Refusal(400, "invalid", "Attach a photo or a PDF.", "file");
    const id = await addPaper(db, c.get("me"), idParam(c), {
      kind: String(body.kind ?? ""),
      name: file.name,
      mime: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return c.json({ id });
  });

  app.get("/api/papers/:id", async (c) => {
    const paper = await readPaper(db, c.get("me"), idParam(c));
    return c.body(paper.bytes as Uint8Array<ArrayBuffer>, 200, {
      "content-type": paper.mime,
      "content-disposition": `inline; filename="${encodeURIComponent(paper.name)}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=604800, immutable",
    });
  });

  app.post("/api/papers/:id/remove", async (c) => {
    await removePaper(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });

  app.post("/api/orders/:id/:action", async (c) => {
    const action = c.req.param("action") as OrderAction;
    if (!ACTIONS.includes(action))
      return c.json({ error: { code: "not_found", message: "No such action." } }, 404);
    const input = await readBody(
      c,
      z.object({
        reason: optional(500),
        warehouseId: z.number().int().positive().nullish(),
        // Approving: Management decides whether Finance checks it too (field orders ask nothing).
        finance: z.boolean().optional(),
        // Holding until stock comes in.
        stock: z.boolean().optional(),
        // Taking it off hold: the step it goes on from (Management may pick an earlier one).
        to: z.enum(["pending_approval", "finance_check", "ready_for_invoice", "ready_for_dispatch", "packing", "shipped"]).optional(),
      }),
    );
    const before = await actOnOrder(db, c.get("me"), idParam(c), action, input);
    // A cancelled order frees what it promised: someone waiting may now be covered.
    if (action === "cancel")
      await tellSafely(async () => {
        await tellStockBack(db);
      });
    await tellSafely(() =>
      tellAboutOrder(db, c.get("me"), idParam(c), action, input.reason ?? null, before),
    );
    // Whatever the step was, the customer hears the newest one once (approved straight through, sent out…).
    void tellCustomer(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });
}
