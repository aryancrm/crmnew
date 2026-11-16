// Modern Trade: the COO's chains and their listings.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, readBody } from "../http";
import { mtDay, saveListing } from "./service";

export function mtRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/mt/*", signedIn);
  app.get("/api/mt/day", async (c) => c.json(await mtDay(db, c.get("me"))));
  app.post("/api/mt/listings", async (c) => {
    const input = await readBody(
      c,
      z.object({
        customerId: z.number().int().positive(),
        medicineId: z.number().int().positive(),
        branches: z.number().int().min(0).max(10000),
        listed: z.boolean(),
        note: z.string().max(300).nullish(),
      }),
    );
    await saveListing(db, c.get("me"), input);
    return c.json({ ok: true });
  });
}
