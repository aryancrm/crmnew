// A seller's day: today's pulse, collections, the 7 PM huddle (declared by the seller, read by
// the coach).

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, readBody } from "../http";
import { district } from "./district";
import { collections, declareHuddle, myHuddle, pulse, teamHuddle } from "./service";

const MONEY = z.number().int().min(0).max(100_000_000_000);

export function sellerRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  for (const path of ["/api/my/pulse", "/api/my/collections", "/api/huddle", "/api/huddle/*", "/api/team/district"]) app.use(path, signedIn);

  app.get("/api/team/district", async (c) => c.json(await district(db, c.get("me"))));

  app.get("/api/my/pulse", async (c) => c.json(await pulse(db, c.get("me"))));
  app.get("/api/my/collections", async (c) => c.json(await collections(db, c.get("me"))));
  app.get("/api/huddle", async (c) => c.json(await myHuddle(db, c.get("me"))));
  app.get("/api/huddle/team", async (c) => c.json(await teamHuddle(db, c.get("me"), { day: c.req.query("day") })));
  app.post("/api/huddle", async (c) => {
    const input = await readBody(
      c,
      z.object({
        sales: MONEY,
        collected: MONEY,
        visits: z.number().int().min(0).max(100),
        invoiced: z.boolean(),
        blocker: z.string().max(500).nullish(),
        tomorrow: z.string().max(300).nullish(),
      }),
    );
    await declareHuddle(db, c.get("me"), input);
    return c.json({ ok: true });
  });
}
