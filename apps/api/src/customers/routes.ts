// Customers' addresses. Everyone signed in may ask; the service decides which customers each
// person sees.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { allow, type Env, idParam, readBody } from "../http";
import { customerPage } from "./page";
import {
  addCustomer,
  CUSTOMER_ADD_ROLES,
  CUSTOMER_KINDS,
  CUSTOMER_MANAGE_ROLES,
  checkCustomer,
  customerDetail,
  listCustomers,
  myArea,
  reviewCustomer,
  saveCustomer,
  toCollect,
} from "./service";

const text = (max: number) => z.string().trim().max(max, `Keep it under ${max} characters.`);
const optional = (max: number) => text(max).nullish();
const kind = z.enum(CUSTOMER_KINDS.map((entry) => entry.key) as [string, ...string[]], {
  error: "Pick what kind of customer this is.",
});

const customerInput = z.object({
  kind,
  name: text(160).min(2, "Type the customer's name."),
  phone: optional(40).refine(
    (value) => !value || value.replace(/\D/g, "").length >= 7,
    "That phone number is too short.",
  ),
  email: optional(160).refine(
    (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value),
    "That isn't an email address.",
  ),
  address: optional(300),
  city: optional(80),
  specialty: optional(80),
  worksAt: z.number().int().positive().nullish(),
  licenceNo: optional(60),
  licenceExpires: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.")
    .nullish()
    .or(z.literal("")),
  tin: optional(40),
  note: optional(500),
  areaId: z.number().int().positive().nullish(),
  paymentTerms: z.enum(["advance", "cod", "days"]).optional(),
  paymentDays: z
    .number()
    .int("Use a whole number.")
    .min(1, "Use 1 day or more.")
    .max(365, "Use 365 days or fewer.")
    .nullish(),
  creditLimit: z.number().int().min(0, "Use zero or more.").max(100_000_000_00).nullish(),
});

export function customerRoutes(
  app: Hono<Env>,
  db: Database,
  signedIn: MiddlewareHandler<Env>,
): void {
  // "/path/*" also covers "/path" itself.
  for (const path of ["/api/customers/*", "/api/my/area", "/api/my/collect"])
    app.use(path, signedIn);

  app.get("/api/customers", async (c) => {
    const query = c.req.query();
    const picked = CUSTOMER_KINDS.find((entry) => entry.key === query.kind)?.key;
    return c.json(
      await listCustomers(db, c.get("me"), {
        kind: picked,
        q: query.q,
        page: Number(query.page) || 1,
        review: query.review === "1",
        medrep: Number(query.medrep) || undefined,
        sort: query.sort,
        owes: query.owes === "any" || query.owes === "overdue" ? query.owes : undefined,
        seat: Number(query.seat) || undefined,
      }),
    );
  });

  // Before /:id, so "check" is never read as an id.
  app.get("/api/customers/check", async (c) => {
    const query = c.req.query();
    const picked = CUSTOMER_KINDS.find((entry) => entry.key === query.kind)?.key;
    return c.json({
      matches: await checkCustomer(db, c.get("me"), {
        name: query.name,
        phone: query.phone,
        kind: picked,
      }),
    });
  });

  app.get("/api/customers/:id", async (c) =>
    c.json(await customerDetail(db, c.get("me"), idParam(c))),
  );
  app.get("/api/customers/:id/page", async (c) =>
    c.json(await customerPage(db, c.get("me"), idParam(c))),
  );

  app.post("/api/customers", async (c) => {
    allow(c.get("me"), CUSTOMER_ADD_ROLES, "add a customer");
    const input = await readBody(c, customerInput);
    return c.json({
      id: await addCustomer(db, c.get("me"), input as Parameters<typeof addCustomer>[2]),
    });
  });

  app.post("/api/customers/:id", async (c) => {
    allow(c.get("me"), CUSTOMER_ADD_ROLES, "change a customer");
    const input = await readBody(c, customerInput);
    await saveCustomer(db, c.get("me"), idParam(c), input as Parameters<typeof saveCustomer>[3]);
    return c.json({ ok: true });
  });

  app.post("/api/customers/:id/review", async (c) => {
    allow(c.get("me"), CUSTOMER_MANAGE_ROLES, "review a new customer");
    await reviewCustomer(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });

  app.get("/api/my/area", async (c) => c.json(await myArea(db, c.get("me"))));
  app.get("/api/my/collect", async (c) => c.json(await toCollect(db, c.get("me"))));
}
