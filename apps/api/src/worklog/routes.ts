// The work log: my day, and the heads' read of a day.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, readBody } from "../http";
import { myWorkLog, workLogDay, writeWorkLog } from "./service";

export function workLogRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/work-log", signedIn);
  app.use("/api/work-log/*", signedIn);
  app.get("/api/work-log", async (c) => c.json(await myWorkLog(db, c.get("me"))));
  app.get("/api/work-log/day", async (c) => c.json(await workLogDay(db, c.get("me"), { day: c.req.query("day") })));
  app.post("/api/work-log", async (c) => {
    const input = await readBody(
      c,
      z.object({ done: z.string().max(2000).nullish(), today: z.string().max(2000).nullish(), tomorrow: z.string().max(2000).nullish() }),
    );
    await writeWorkLog(db, c.get("me"), input);
    return c.json({ ok: true });
  });
}
