// A team lead's (or head's) team, from the seats under them; the CEO and the Admin any box.

import type { Hono, MiddlewareHandler } from "hono";
import type { Database } from "../db/index";
import type { Env } from "../http";
import { teamAccounts } from "./accounts";
import { teamBoard, territories } from "./service";
import { orderWays } from "./ways";
import { headquarters } from "./headquarters";

export function teamRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/team/board", signedIn);
  app.use("/api/team/accounts", signedIn);
  // The team's customers (a box picked: its own), with their buying, gaps, money owed and calls.
  app.get("/api/team/accounts", async (c) => c.json(await teamAccounts(db, c.get("me"))));
  app.use("/api/team/territories", signedIn);
  // The map: each area of the seats in view, the shapes its cities cover (read, never typed).
  app.get("/api/team/territories", async (c) =>
    c.json(await territories(db, c.get("me"), { unitId: Number(c.req.query("unit")) || null })),
  );
  app.use("/api/headquarters", signedIn);
  // Each HQ of the team: who works it, who did before, what it sold this month and today (27 Nov).
  app.get("/api/headquarters", async (c) => c.json(await headquarters(db, c.get("me"), { month: c.req.query("month") })));
  app.use("/api/team/ways", signedIn);
  // How the month's orders came: the doctor dispensing, the doctor's referral, and the rest (27 Nov).
  app.get("/api/team/ways", async (c) => c.json(await orderWays(db, c.get("me"), { month: c.req.query("month") })));
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
