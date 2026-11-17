// To decide: the decisions waiting on the person, and what they asked others for.

import type { Hono, MiddlewareHandler } from "hono";
import type { Database } from "../db/index";
import type { Env } from "../http";
import { auditTrail } from "../audit/trail";
import { decisions } from "./service";

export function decisionRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/decisions", signedIn);
  app.get("/api/decisions", async (c) => c.json(await decisions(db, c.get("me"))));
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
