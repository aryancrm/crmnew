// CLIDP: the Sales Coach's day, listings, the heads' view.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, readBody } from "../http";
import { addListing, clidpDay, clidpTeam } from "./service";

export function clidpRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/clidp/*", signedIn);
  app.get("/api/clidp/day", async (c) => c.json(await clidpDay(db, c.get("me"))));
  app.get("/api/clidp/team", async (c) => c.json(await clidpTeam(db, c.get("me"))));
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
