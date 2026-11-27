// Inventory's addresses. Everyone signed in may look; each write says who may do it.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import { addOffer, endOffer } from "./offers";
import type { Database } from "../db/index";
import { allow, type Env, idParam, may, readBody, Refusal } from "../http";
import { afterStockIn } from "../orders/stock-wait";
import { answerRequest, askForMedicine, medicineRequests, REQUEST_ANSWER_ROLES } from "./requests";
import { BUYER_TYPES, CATALOGUE_ROLES, COST_ROLES, NO_STOCK_ROLES, PRICE_ROLES, STOCK_ROLES } from "./rules";
import { askedOf, stockReport, stockReportWorkbook } from "./stock-report";
import {
  addPromo,
  catalogue,
  closeNews,
  countStock,
  endPromo,
  listInventory,
  medicineDetail,
  moveStock,
  openNews,
  postNews,
  receiveStock,
  saveMedicine,
  setCanvass,
  setPrices,
} from "./service";

const text = (max: number) => z.string().trim().max(max, `Keep it under ${max} characters.`);
const optional = (max: number) => text(max).nullish();
const id = (message: string) => z.number({ error: message }).int(message).positive(message);
const pieces = z
  .number({ error: "Type how many." })
  .int("Use a whole number.")
  .positive("Type how many.")
  .max(1_000_000, "That is too many.");
const centavos = z
  .number({ error: "Type a price." })
  .int("Type a price.")
  .min(0, "A price can't be below zero.")
  .max(100_000_000_00, "That price is too high.");
const date = z
  .string({ error: "Pick a date." })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "That isn't a real date.");

const medicineInput = z.object({
  name: text(120).min(1, "Type the medicine's name."),
  // Zoho's SKUs carry the strength and form ("GM-3398 ( 100 MG ) ( POWDER FOR INJECTION… )").
  sku: optional(80),
  generic: optional(120),
  strength: optional(60),
  form: optional(60),
  pack: optional(60),
  unit: optional(20),
  packSize: z
    .number()
    .int("Use a whole number.")
    .min(1, "A pack holds at least one.")
    .max(100_000)
    .optional(),
  category: optional(80),
  manufacturer: optional(120),
  brand: optional(80),
  rx: z.boolean(),
  coldChain: z.boolean().optional(),
  coldBox: z.boolean().optional(),
  noSamples: z.boolean().optional(),
  vat: z.enum(["exempt", "vat12", "zero"]),
  reorderLevel: z.number().int("Use a whole number.").min(0, "Use zero or more.").max(1_000_000),
});

export function inventoryRoutes(
  app: Hono<Env>,
  db: Database,
  signedIn: MiddlewareHandler<Env>,
): void {
  // "/path/*" also covers "/path" itself.
  app.use("/api/inventory/*", signedIn);
  app.use("/api/stock-news/*", signedIn);
  // HR has no business in the stock (26 Nov): not the medicines, the prices, nor a request for one.
  app.use("/api/inventory/*", async (c, next) => {
    if (NO_STOCK_ROLES.includes(c.get("me").role))
      throw new Refusal(403, "not_allowed", "The stock isn't part of HR's work.");
    await next();
  });

  app.get("/api/inventory", async (c) => c.json(await listInventory(db, c.get("me"))));

  app.get("/api/inventory/medicines", async (c) => c.json(await catalogue(db, c.get("me"))));

  // The stock report, batch by batch, on the screen and as an Excel file with the same rows.
  // Everyone signed in reads the stock; what it cost goes only to COST_ROLES (stockReport checks).
  app.get("/api/inventory/stock-report", async (c) =>
    c.json(await stockReport(db, c.get("me"), askedOf((name) => c.req.query(name)))),
  );
  app.get("/api/inventory/stock-report.xlsx", async (c) => {
    const report = await stockReport(db, c.get("me"), askedOf((name) => c.req.query(name)));
    return c.body(new Uint8Array(stockReportWorkbook(report)), 200, {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="stock-report-${report.today}.xlsx"`,
    });
  });

  // "Medicine not available": anyone asks; Inventory answers.
  app.get("/api/inventory/requests", async (c) =>
    c.json(await medicineRequests(db, c.get("me"), { show: c.req.query("show") })),
  );
  app.post("/api/inventory/requests", async (c) => {
    const input = await readBody(
      c,
      z.object({
        medicineId: z.number().int().positive().nullish(),
        name: z.string().trim().min(1, "Write the medicine's name.").max(120),
        strength: z.string().trim().max(60).nullish(),
        qty: z.number().int("Use a whole number.").min(0).max(1_000_000).nullish(),
        customerId: z.number().int().positive().nullish(),
        note: z.string().trim().max(500).nullish(),
      }),
    );
    return c.json({ id: await askForMedicine(db, c.get("me"), input) });
  });
  app.post("/api/inventory/requests/:id/answer", async (c) => {
    allow(c.get("me"), REQUEST_ANSWER_ROLES, "answer a medicine request");
    const input = await readBody(
      c,
      z.object({
        status: z.enum(["ordered", "added", "declined"]),
        answer: z.string().trim().max(500).nullish(),
      }),
    );
    await answerRequest(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });

  app.get("/api/inventory/medicines/:id", async (c) =>
    c.json(await medicineDetail(db, c.get("me"), idParam(c))),
  );

  app.post("/api/inventory/medicines", async (c) => {
    allow(c.get("me"), CATALOGUE_ROLES, "add a medicine");
    return c.json({ id: await saveMedicine(db, null, await readBody(c, medicineInput)) });
  });

  app.post("/api/inventory/medicines/:id", async (c) => {
    allow(c.get("me"), CATALOGUE_ROLES, "change a medicine");
    return c.json({ id: await saveMedicine(db, idParam(c), await readBody(c, medicineInput)) });
  });

  app.post("/api/inventory/medicines/:id/prices", async (c) => {
    allow(c.get("me"), PRICE_ROLES, "change prices");
    const shape = Object.fromEntries(
      BUYER_TYPES.map(({ key }) => [key, centavos.nullable().optional()]),
    );
    const input = await readBody(
      c,
      z.object({ prices: z.object(shape), packPrices: z.object(shape).optional() }),
    );
    await setPrices(db, c.get("me"), idParam(c), input.prices, input.packPrices ?? {});
    return c.json({ ok: true });
  });

  // PCSO's quotations 2 and 3: the other vendors' price for one piece (Aryan, 26 Nov).
  app.post("/api/inventory/medicines/:id/canvass", async (c) => {
    allow(c.get("me"), PRICE_ROLES, "change prices");
    const quote = z
      .object({ vendor: z.string().max(120), amount: centavos })
      .nullable()
      .optional();
    const input = await readBody(c, z.object({ 2: quote, 3: quote }));
    await setCanvass(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });

  app.post("/api/inventory/medicines/:id/promos", async (c) => {
    allow(c.get("me"), PRICE_ROLES, "add a promo");
    const input = await readBody(
      c,
      z.object({
        name: text(80).min(1, "Name the promo."),
        amount: centavos,
        startsOn: date,
        endsOn: date,
      }),
    );
    await addPromo(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });

  // Offers: Buy X Take Y and / or a special price, for a kind of buyer or every buyer.
  app.post("/api/inventory/medicines/:id/offers", async (c) => {
    allow(c.get("me"), PRICE_ROLES, "add an offer");
    const input = await readBody(
      c,
      z.object({
        buyerKind: z
          .enum(["hospital", "doctor", "patient", "drugstore", "distributor", "government"])
          .nullable(),
        buy: z.number({ error: "Say how many are bought." }).int().min(1, "At least one is bought.").max(1000),
        take: z.number({ error: "Say how many are free." }).int().min(0).max(1000),
        price: centavos.nullable(),
        name: text(80).nullish(),
        note: text(300).nullish(),
        startsOn: date,
        // None: it runs until someone ends it.
        endsOn: date.nullish(),
      }),
    );
    return c.json({ id: await addOffer(db, c.get("me"), idParam(c), input) });
  });
  app.post("/api/inventory/offers/:id/end", async (c) => {
    allow(c.get("me"), PRICE_ROLES, "end an offer");
    await endOffer(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });

  app.post("/api/inventory/promos/:id/end", async (c) => {
    allow(c.get("me"), PRICE_ROLES, "end a promo");
    await endPromo(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });

  app.post("/api/inventory/receive", async (c) => {
    allow(c.get("me"), STOCK_ROLES, "receive stock");
    const input = await readBody(
      c,
      z.object({
        medicineId: id("Pick a medicine."),
        warehouseId: id("Pick a warehouse."),
        batchNo: text(40).min(1, "Type the batch number on the box."),
        expiresOn: date,
        qty: pieces,
        ref: optional(60),
        note: optional(300),
        unitCost: centavos.nullish(),
      }),
    );
    const me = c.get("me");
    // Only those who see costs may record one.
    const received = await receiveStock(db, me, {
      ...input,
      unitCost: may(me, COST_ROLES) ? input.unitCost : null,
    });
    await afterStockIn(db);
    return c.json(received);
  });

  app.post("/api/inventory/move", async (c) => {
    allow(c.get("me"), STOCK_ROLES, "move stock");
    const input = await readBody(
      c,
      z.object({
        batchId: id("Pick a batch."),
        fromWarehouseId: id("Pick the warehouse it is in."),
        toWarehouseId: id("Pick the warehouse it goes to."),
        qty: pieces,
        note: optional(300),
      }),
    );
    await moveStock(db, c.get("me"), input);
    return c.json({ ok: true });
  });

  app.post("/api/inventory/count", async (c) => {
    allow(c.get("me"), STOCK_ROLES, "count stock");
    const input = await readBody(
      c,
      z.object({
        batchId: id("Pick a batch."),
        warehouseId: id("Pick a warehouse."),
        counted: z
          .number({ error: "Type what you counted." })
          .int("Use a whole number.")
          .min(0, "Use zero or more.")
          .max(1_000_000),
        reason: optional(300),
      }),
    );
    const counted = await countStock(db, c.get("me"), input);
    if (counted.difference > 0) await afterStockIn(db);
    return c.json(counted);
  });

  app.get("/api/stock-news", async (c) => c.json({ news: await openNews(db) }));

  app.post("/api/stock-news", async (c) => {
    allow(c.get("me"), STOCK_ROLES, "post stock news");
    const input = await readBody(
      c,
      z.object({
        medicineId: id("Pick a medicine."),
        kind: z.enum(["out", "low", "back", "note"]),
        message: optional(300),
      }),
    );
    await postNews(db, c.get("me"), input);
    return c.json({ ok: true });
  });

  app.post("/api/stock-news/:id/close", async (c) => {
    allow(c.get("me"), STOCK_ROLES, "take stock news down");
    await closeNews(db, idParam(c));
    return c.json({ ok: true });
  });
}
