// To decide: the decisions waiting on the person, and what they asked others for.

import type { Hono, MiddlewareHandler } from "hono";
import type { Database } from "../db/index";
import type { Env } from "../http";
import { decisions } from "./service";

export function decisionRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/decisions", signedIn);
  app.get("/api/decisions", async (c) => c.json(await decisions(db, c.get("me"))));
}
