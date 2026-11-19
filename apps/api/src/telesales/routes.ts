// A telesales team at a glance: calls, callbacks, orders, conversion, customers, money.

import type { Hono, MiddlewareHandler } from "hono";
import type { Database } from "../db/index";
import type { Env } from "../http";
import { telesalesTeam } from "./team";

export function telesalesRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/telesales/*", signedIn);
  app.get("/api/telesales/team", async (c) => c.json(await telesalesTeam(db, c.get("me"))));
}
