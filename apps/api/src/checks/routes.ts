// The data checks' address: the Admin and the CEO run them.

import type { Hono, MiddlewareHandler } from "hono";
import type { Database } from "../db/index";
import type { Env } from "../http";
import { dataChecks } from "./integrity";

export function checkRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.get("/api/admin/data-checks", signedIn, async (c) =>
    c.json(await dataChecks(db, c.get("me"))),
  );
}
