// The B2C CHC's day and the coach's B2C desk.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, readBody } from "../http";
import { b2cDay, b2cTeam, day3Done } from "./service";

export function b2cRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/b2c/*", signedIn);
  app.get("/api/b2c/day", async (c) => c.json(await b2cDay(db, c.get("me"))));
  app.get("/api/b2c/team", async (c) => c.json(await b2cTeam(db, c.get("me"))));
  app.post("/api/b2c/day3/:orderId", async (c) => {
    const input = await readBody(c, z.object({ note: z.string().trim().min(3, "Write what the customer said.").max(500) }));
    await day3Done(db, c.get("me"), Number(c.req.param("orderId")), input.note);
    return c.json({ ok: true });
  });
}
