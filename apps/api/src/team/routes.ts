// A team lead's (or head's) team, from the seats under them; the CEO and the Admin any box.

import type { Hono, MiddlewareHandler } from "hono";
import type { Database } from "../db/index";
import type { Env } from "../http";
import { teamBoard } from "./service";

export function teamRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/team/board", signedIn);
  app.get("/api/team/board", async (c) =>
    c.json(
      await teamBoard(db, c.get("me"), {
        unitId: Number(c.req.query("unit")) || null,
        from: c.req.query("from"),
        to: c.req.query("to"),
      }),
    ),
  );
}
