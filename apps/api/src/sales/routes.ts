// Sales against target: a team's month, the channels', the CEO Home and the company tree.

import type { Hono, MiddlewareHandler } from "hono";
import type { Database } from "../db/index";
import { allow, type Env } from "../http";
import { monthFacts } from "./rules";
import { ceoHome, channelSales, companyTree, teamSales } from "./service";

export function salesRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  for (const path of ["/api/team/*", "/api/ceo/*", "/api/company/*", "/api/channel-sales/*"])
    app.use(path, signedIn);

  app.get("/api/team/sales", async (c) =>
    c.json(await teamSales(db, c.get("me"), c.req.query("month"))),
  );
  app.get("/api/ceo/home", async (c) =>
    c.json(
      await ceoHome(db, c.get("me"), c.req.query("month"), {
        from: c.req.query("from"),
        to: c.req.query("to"),
      }),
    ),
  );
  app.get("/api/company/tree", async (c) =>
    c.json(await companyTree(db, c.get("me"), c.req.query("month"))),
  );
  app.get("/api/channel-sales", async (c) => {
    allow(c.get("me"), ["ceo", "admin", "management", "finance"], "see sales by channel");
    const facts = monthFacts(c.req.query("month"));
    return c.json({ ...facts, channels: await channelSales(db, facts) });
  });
}
