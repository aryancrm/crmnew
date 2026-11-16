// The Rx CHC's doctor list and day.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, readBody } from "../http";
import { careGroups, closeGroup, contactGroup, enrolGroup, groupActivity } from "./groups";
import { rxDay, rxField, setTier } from "./service";

export function rxRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/rx/*", signedIn);
  app.use("/api/care-groups", signedIn);
  app.use("/api/care-groups/*", signedIn);

  app.get("/api/care-groups", async (c) => c.json(await careGroups(db, c.get("me"))));
  app.post("/api/care-groups", async (c) => {
    const input = await readBody(
      c,
      z.object({
        doctorId: z.number().int().positive(),
        patients: z.number().int().min(0).max(500),
        consent: z.boolean(),
        note: z.string().max(500).nullish(),
      }),
    );
    return c.json(await enrolGroup(db, c.get("me"), input));
  });
  app.post("/api/care-groups/:id/contact", async (c) => {
    await contactGroup(db, c.get("me"), Number(c.req.param("id")));
    return c.json({ ok: true });
  });
  app.post("/api/care-groups/:id/activity", async (c) => {
    const input = await readBody(c, z.object({ patients: z.number().int().min(0).max(500).nullish(), note: z.string().max(500).nullish() }));
    await groupActivity(db, c.get("me"), Number(c.req.param("id")), input);
    return c.json({ ok: true });
  });
  app.post("/api/care-groups/:id/close", async (c) => {
    const input = await readBody(c, z.object({ reason: z.string().trim().min(3, "Say why it closes.").max(300) }));
    await closeGroup(db, c.get("me"), Number(c.req.param("id")), input.reason);
    return c.json({ ok: true });
  });
  app.get("/api/rx/day", async (c) => c.json(await rxDay(db, c.get("me"))));
  app.get("/api/rx/field", async (c) => c.json(await rxField(db, c.get("me"))));
  app.post("/api/rx/doctors", async (c) => {
    const input = await readBody(
      c,
      z.object({ customerId: z.number().int().positive(), tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable() }),
    );
    await setTier(db, c.get("me"), input);
    return c.json({ ok: true });
  });
}
