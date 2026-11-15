// Speed: how long each desk keeps an order, and who is slow.

import type { Hono, MiddlewareHandler } from "hono";
import type { Database } from "../db/index";
import type { Env } from "../http";
import { speedReport } from "./service";

export function speedRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/speed", signedIn);
  app.get("/api/speed", async (c) =>
    c.json(
      await speedReport(db, c.get("me"), { from: c.req.query("from"), to: c.req.query("to") }),
    ),
  );
}
