// The Rx CHC's doctor list and day.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, readBody } from "../http";
import { rxDay, setTier } from "./service";

export function rxRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/rx/*", signedIn);
  app.get("/api/rx/day", async (c) => c.json(await rxDay(db, c.get("me"))));
  app.post("/api/rx/doctors", async (c) => {
    const input = await readBody(
      c,
      z.object({ customerId: z.number().int().positive(), tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable() }),
    );
    await setTier(db, c.get("me"), input);
    return c.json({ ok: true });
  });
}
