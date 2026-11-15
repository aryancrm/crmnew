// The bell's routes: a person's own notifications, and marking them read.

import type { Hono, MiddlewareHandler } from "hono";
import type { Database } from "../db/index";
import { type Env, idParam } from "../http";
import { myNotifications, readAllNotifications, readNotification } from "./service";

export function notifyRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/notifications/*", signedIn);
  app.use("/api/notifications", signedIn);
  app.get("/api/notifications", async (c) => c.json(await myNotifications(db, c.get("me"))));
  app.post("/api/notifications/read-all", async (c) => {
    await readAllNotifications(db, c.get("me"));
    return c.json({ ok: true });
  });
  app.post("/api/notifications/:id/read", async (c) => {
    await readNotification(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });
}
