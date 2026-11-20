// My KPIs' address (the hub's /api/kpi/me): a person's month and, for a lead, their team's; the
// CEO's and the Admin's the company's. ?day= adds that day's sales.

import type { Hono, MiddlewareHandler } from "hono";
import type { Database } from "../db/index";
import type { Env } from "../http";
import { myKpiPanel } from "./service";

export function kpiRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/kpis/*", signedIn);
  app.get("/api/kpis/me", async (c) =>
    c.json(await myKpiPanel(db, c.get("me"), { month: c.req.query("month"), day: c.req.query("day") })),
  );
}
