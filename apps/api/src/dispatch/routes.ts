// Dispatch's addresses. The service checks who may do what.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, idParam, readBody } from "../http";
import { tellAboutOrder } from "../notify/service";
import { tellCustomer } from "../online/tell";
import { tellSafely } from "../orders/routes";
import { dispatchBoard } from "./board";
import { dispatchKpis } from "./kpis";
import { COURIERS } from "./rules";
import {
  deliverOrder,
  failedDelivery,
  listShipments,
  packOrder,
  packPlan,
  setTracking,
  shipOrder,
  takeOrder,
  unpackOrder,
} from "./service";

const optional = (max: number) =>
  z.string().trim().max(max, `Keep it under ${max} characters.`).nullish();

export function dispatchRoutes(
  app: Hono<Env>,
  db: Database,
  signedIn: MiddlewareHandler<Env>,
): void {
  for (const path of ["/api/dispatch/*", "/api/shipments/*"]) app.use(path, signedIn);

  app.get("/api/dispatch/couriers", (c) => c.json({ couriers: COURIERS }));
  app.get("/api/dispatch/orders/:id/pack", async (c) =>
    c.json(await packPlan(db, c.get("me"), idParam(c))),
  );
  app.post("/api/dispatch/orders/:id/pack", async (c) => {
    const input = await readBody(
      c,
      z.object({
        picks: z
          .array(
            z.object({
              itemId: z.number().int().positive(),
              batchId: z.number().int().positive(),
              qty: z.number().int("Use a whole number.").positive("Pick at least one."),
            }),
          )
          .max(200)
          .nullish(),
      }),
    );
    await packOrder(db, c.get("me"), idParam(c), { picks: input.picks ?? undefined });
    return c.json({ ok: true });
  });
  app.post("/api/dispatch/orders/:id/unpack", async (c) => {
    const input = await readBody(c, z.object({ reason: optional(300) }));
    await unpackOrder(db, c.get("me"), idParam(c), input.reason ?? null);
    return c.json({ ok: true });
  });
  app.post("/api/dispatch/orders/:id/ship", async (c) => {
    const input = await readBody(
      c,
      z.object({
        method: z.enum(["courier", "rider"], { error: "Pick how it goes." }),
        courier: optional(60),
        tracking: optional(200),
        rider: optional(80),
        note: optional(300),
      }),
    );
    await shipOrder(db, c.get("me"), idParam(c), input);
    void tellCustomer(db, c.get("me"), idParam(c), "shipped");
    return c.json({ ok: true });
  });
  app.post("/api/dispatch/orders/:id/tracking", async (c) => {
    const input = await readBody(c, z.object({ courier: optional(60), tracking: optional(200) }));
    await setTracking(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.post("/api/dispatch/orders/:id/deliver", async (c) => {
    const input = await readBody(
      c,
      z.object({
        receivedBy: z
          .string({ error: "Type who received it." })
          .trim()
          .min(1, "Type who received it.")
          .max(120),
        deliveredOn: z
          .string({ error: "Pick the day." })
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day."),
        note: optional(300),
      }),
    );
    await deliverOrder(db, c.get("me"), idParam(c), input);
    void tellCustomer(db, c.get("me"), idParam(c), "delivered");
    return c.json({ ok: true });
  });
  app.post("/api/dispatch/orders/:id/failed", async (c) => {
    const input = await readBody(c, z.object({ reason: optional(300) }));
    await failedDelivery(db, c.get("me"), idParam(c), input.reason ?? null);
    await tellSafely(() =>
      tellAboutOrder(db, c.get("me"), idParam(c), "failed", input.reason ?? null, "shipped"),
    );
    return c.json({ ok: true });
  });

  // Who in the warehouse has it in hand: take it (or take it over), or let it go.
  app.post("/api/dispatch/orders/:id/take", async (c) => {
    const input = await readBody(c, z.object({ release: z.boolean().optional() }));
    await takeOrder(db, c.get("me"), idParam(c), Boolean(input.release));
    return c.json({ ok: true });
  });

  app.get("/api/dispatch/board", async (c) => c.json(await dispatchBoard(db, c.get("me"))));

  app.get("/api/dispatch/kpis", async (c) =>
    c.json(
      await dispatchKpis(db, c.get("me"), {
        period: c.req.query("period"),
        day: c.req.query("day"),
      }),
    ),
  );

  app.get("/api/shipments", async (c) => {
    const query = c.req.query();
    return c.json(
      await listShipments(db, c.get("me"), {
        tab: query.tab,
        q: query.q,
        page: Number(query.page) || 1,
      }),
    );
  });
}
