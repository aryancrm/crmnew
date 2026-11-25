// To decide: the decisions waiting on the person, and what they asked others for.

import { personReport } from "../reports/person";
import type { Hono, MiddlewareHandler } from "hono";
import type { Database } from "../db/index";
import type { Env } from "../http";
import { auditTrail } from "../audit/trail";
import { traceBatch } from "../inventory/trace";
import { decisions } from "./service";

export function decisionRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/decisions", signedIn);
  app.get("/api/decisions", async (c) => c.json(await decisions(db, c.get("me"))));
  // A batch traced for a recall (ERP phase 3).
  app.use("/api/trace", signedIn);
  app.get("/api/trace", async (c) => c.json(await traceBatch(db, c.get("me"), { batch: c.req.query("batch") })));
  // The CEO's custom report: one person, any days, the parts ticked (22 Nov).
  app.use("/api/reports/person", signedIn);
  app.get("/api/reports/person", async (c) =>
    c.json(await personReport(db, c.get("me"), { person: c.req.query("person"), from: c.req.query("from"), to: c.req.query("to"), parts: c.req.query("parts") })),
  );
  // Who did what, when, across the CRM (ERP phase 2).
  app.use("/api/audit", signedIn);
  app.get("/api/audit", async (c) =>
    c.json(
      await auditTrail(db, c.get("me"), {
        kind: c.req.query("kind"),
        who: c.req.query("who"),
        q: c.req.query("q"),
        from: c.req.query("from"),
        to: c.req.query("to"),
        page: Number(c.req.query("page")) || 1,
      }),
    ),
  );
}
