// CLIDP: the Sales Coach's day, listings, the heads' view.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, readBody } from "../http";
import { addProspect, CLIDP_STAGES, clidpRoad, moveClidp, setClidpRate } from "./road";
import { addListing, clidpDay, clidpTeam } from "./service";

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day.");

export function clidpRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/clidp/*", signedIn);
  app.get("/api/clidp/day", async (c) => c.json(await clidpDay(db, c.get("me"))));
  app.get("/api/clidp/team", async (c) => c.json(await clidpTeam(db, c.get("me"))));
  // CLIDP's road: each pharmacy or distributor from the first visit to ordering, its rate, its listings.
  app.get("/api/clidp/road", async (c) => c.json(await clidpRoad(db, c.get("me"))));
  app.post("/api/clidp/road", async (c) => {
    const input = await readBody(
      c,
      z.object({
        customerId: z.number().int().positive(),
        on: DAY.nullish(),
        note: z.string().max(500).nullish(),
        nextStep: z.string().max(200).nullish(),
        nextOn: DAY.nullish(),
        coachId: z.number().int().positive().nullish(),
      }),
    );
    await addProspect(db, c.get("me"), input);
    return c.json({ ok: true });
  });
  app.post("/api/clidp/road/:customerId", async (c) => {
    const input = await readBody(
      c,
      z.object({
        stage: z.enum(CLIDP_STAGES as [string, ...string[]]),
        on: DAY.nullish(),
        note: z.string().max(500).nullish(),
        declinedReason: z.string().max(300).nullish(),
        agreementUntil: DAY.nullish(),
        nextStep: z.string().max(200).nullish(),
        nextOn: DAY.nullish(),
      }),
    );
    await moveClidp(db, c.get("me"), Number(c.req.param("customerId")), input as Parameters<typeof moveClidp>[3]);
    return c.json({ ok: true });
  });
  app.post("/api/clidp/rates", async (c) => {
    const input = await readBody(
      c,
      z.object({
        customerId: z.number().int().positive(),
        medicineId: z.number().int().positive(),
        unitPrice: z.number().int().min(0).max(10_000_000_000),
        moq: z.number().int().positive().nullish(),
        on: DAY.nullish(),
      }),
    );
    await setClidpRate(db, c.get("me"), input);
    return c.json({ ok: true });
  });
  app.post("/api/clidp/listings", async (c) => {
    const input = await readBody(
      c,
      z.object({
        customerId: z.number().int().positive(),
        medicineId: z.number().int().positive(),
        brand: z.string().trim().min(2, "Type the brand they list it under."),
        certificateNo: z.string().max(80).nullish(),
        validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
      }),
    );
    await addListing(db, c.get("me"), input);
    return c.json({ ok: true });
  });
}
