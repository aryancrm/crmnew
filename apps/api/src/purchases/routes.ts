// Purchases and suppliers. Seen by those who see costs; changed by Inventory and Admin.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { allow, type Env, idParam, readBody } from "../http";
import { COST_ROLES, PURCHASE_ROLES } from "../inventory/rules";
import {
  cancelPurchase,
  listPurchases,
  listSuppliers,
  purchaseChoices,
  purchaseDetail,
  receivePurchase,
  savePurchase,
  saveSupplier,
} from "./service";

const text = (max: number) => z.string().trim().max(max, `Keep it under ${max} characters.`);
const optional = (max: number) => text(max).nullish();
const id = (message: string) => z.number({ error: message }).int(message).positive(message);
const date = z
  .string({ error: "Pick a date." })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "That isn't a real date.");
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use the 3-letter code, like USD.");
const pieces = z
  .number({ error: "Type how many." })
  .int("Use a whole number.")
  .max(1_000_000, "That is too many.");

const purchaseInput = z.object({
  supplierId: id("Pick a supplier."),
  warehouseId: id("Pick a warehouse."),
  orderedOn: date,
  expectedOn: date,
  currency,
  fxRate: z
    .number({ error: "Type the rate." })
    .positive("Type the rate.")
    .max(100_000, "That rate is too high."),
  supplierRef: optional(60),
  note: optional(500),
  lines: z
    .array(
      z.object({
        medicineId: id("Pick a medicine."),
        qty: pieces.positive("Type how many."),
        unitCost: z
          .number({ error: "Type the price." })
          .min(0, "Type the price.")
          .max(1_000_000_000, "That price is too high."),
      }),
    )
    .min(1, "Add at least one medicine.")
    .max(60, "That is too many lines for one purchase."),
  costs: z
    .array(
      z.object({
        kind: z.enum(["freight", "packaging", "customs", "insurance", "transport", "other"]),
        amount: z
          .number({ error: "Type the amount." })
          .int("Type the amount.")
          .min(0, "Type the amount.")
          .max(100_000_000_00),
        note: optional(120),
      }),
    )
    .max(20, "That is too many costs."),
});

const supplierInput = z.object({
  name: text(120).min(1, "Type the supplier's name."),
  country: optional(60),
  currency,
  contact: optional(200),
  active: z.boolean().optional(),
});

export function purchaseRoutes(
  app: Hono<Env>,
  db: Database,
  signedIn: MiddlewareHandler<Env>,
): void {
  // "/path/*" also covers "/path" itself.
  for (const path of ["/api/purchases/*", "/api/suppliers/*"]) app.use(path, signedIn);

  app.get("/api/purchases", async (c) => {
    allow(c.get("me"), COST_ROLES, "see purchases");
    return c.json(await listPurchases(db, c.get("me")));
  });

  app.get("/api/purchases/choices", async (c) => {
    allow(c.get("me"), PURCHASE_ROLES, "make a purchase");
    return c.json(await purchaseChoices(db));
  });

  app.get("/api/purchases/:id", async (c) => {
    allow(c.get("me"), COST_ROLES, "see purchases");
    return c.json(await purchaseDetail(db, c.get("me"), idParam(c)));
  });

  app.post("/api/purchases", async (c) => {
    allow(c.get("me"), PURCHASE_ROLES, "make a purchase");
    return c.json({
      id: await savePurchase(db, c.get("me"), null, await readBody(c, purchaseInput)),
    });
  });

  app.post("/api/purchases/:id", async (c) => {
    allow(c.get("me"), PURCHASE_ROLES, "change a purchase");
    return c.json({
      id: await savePurchase(db, c.get("me"), idParam(c), await readBody(c, purchaseInput)),
    });
  });

  app.post("/api/purchases/:id/receive", async (c) => {
    allow(c.get("me"), PURCHASE_ROLES, "receive a purchase");
    const input = await readBody(
      c,
      z.object({
        lines: z
          .array(
            z.object({
              lineId: id("Pick the line."),
              qty: pieces.min(0, "Use zero or more."),
              batchNo: optional(40),
              expiresOn: date.nullish().or(z.literal("")),
            }),
          )
          .min(1, "Say how many arrived."),
      }),
    );
    await receivePurchase(db, c.get("me"), idParam(c), input.lines);
    return c.json({ ok: true });
  });

  app.post("/api/purchases/:id/cancel", async (c) => {
    allow(c.get("me"), PURCHASE_ROLES, "cancel a purchase");
    await cancelPurchase(db, idParam(c));
    return c.json({ ok: true });
  });

  app.get("/api/suppliers", async (c) => {
    allow(c.get("me"), COST_ROLES, "see suppliers");
    return c.json({ suppliers: await listSuppliers(db) });
  });

  app.post("/api/suppliers", async (c) => {
    allow(c.get("me"), PURCHASE_ROLES, "add a supplier");
    return c.json({ id: await saveSupplier(db, null, await readBody(c, supplierInput)) });
  });

  app.post("/api/suppliers/:id", async (c) => {
    allow(c.get("me"), PURCHASE_ROLES, "change a supplier");
    return c.json({ id: await saveSupplier(db, idParam(c), await readBody(c, supplierInput)) });
  });
}
