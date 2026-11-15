// Home's figures, the stock ledger lists and the search box. Everyone signed in may read them;
// each answer holds only what that person may see.

import type { Hono, MiddlewareHandler } from "hono";
import type { Database } from "../db/index";
import { allow, type Env } from "../http";
import type { MoveKind } from "../types";
import { channelReport, listMoves, overview, REPORT_ROLES, search } from "./service";

const MOVE_KINDS: readonly MoveKind[] = ["adjust", "transfer", "receive"];

export function overviewRoutes(
  app: Hono<Env>,
  db: Database,
  signedIn: MiddlewareHandler<Env>,
): void {
  for (const path of ["/api/overview", "/api/search", "/api/moves", "/api/reports/*"])
    app.use(path, signedIn);

  app.get("/api/overview", async (c) => c.json(await overview(db, c.get("me"))));

  app.get("/api/search", async (c) =>
    c.json(await search(db, c.get("me"), c.req.query("q") ?? "")),
  );

  app.get("/api/reports/channels", async (c) => {
    allow(c.get("me"), REPORT_ROLES, "see the company's reports");
    return c.json(await channelReport(db));
  });

  app.get("/api/moves", async (c) => {
    const asked = c.req.query("kind") as MoveKind;
    const kind = MOVE_KINDS.includes(asked) ? asked : "adjust";
    return c.json(await listMoves(db, kind, Number(c.req.query("page")) || 1));
  });
}
