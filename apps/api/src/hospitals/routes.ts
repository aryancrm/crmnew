// The hospitals board: each hospital's standing for us (accreditation, formulary), its buying, its
// orders, money, visits and calls.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, readBody } from "../http";
import { hospitalBoard, setAccreditation, setFormulary } from "./service";

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day.");

export function hospitalRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/hospitals", signedIn);
  app.use("/api/hospitals/*", signedIn);
  app.get("/api/hospitals", async (c) => c.json(await hospitalBoard(db, c.get("me"))));
  app.post("/api/hospitals/accreditation", async (c) => {
    const input = await readBody(
      c,
      z.object({
        customerId: z.number().int().positive(),
        status: z.enum(["applied", "accredited", "refused"]),
        on: DAY.nullish(),
        validUntil: DAY.nullish(),
        note: z.string().max(400).nullish(),
      }),
    );
    await setAccreditation(db, c.get("me"), input);
    return c.json({ ok: true });
  });
  app.post("/api/hospitals/formulary", async (c) => {
    const input = await readBody(
      c,
      z.object({
        customerId: z.number().int().positive(),
        medicineId: z.number().int().positive(),
        status: z.enum(["requested", "approved", "not_approved", "removed"]),
        on: DAY.nullish(),
        doctor: z.string().max(120).nullish(),
        note: z.string().max(400).nullish(),
      }),
    );
    await setFormulary(db, c.get("me"), input);
    return c.json({ ok: true });
  });
}
