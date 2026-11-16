// Targets' addresses.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, readBody } from "../http";
import { copyLastTargets, listTargets, setSeatTarget, setTarget } from "./service";

export function targetRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/targets/*", signedIn);

  app.get("/api/targets", async (c) =>
    c.json(await listTargets(db, c.get("me"), c.req.query("month"))),
  );

  app.post("/api/targets", async (c) => {
    const input = await readBody(
      c,
      z.object({
        personId: z.number().int().positive(),
        month: z.string(),
        amount: z
          .number({ error: "Type the target." })
          .int("Type the target.")
          .min(0, "Use zero or more.")
          .max(100_000_000_000, "That target is too high.")
          .nullable(),
      }),
    );
    await setTarget(db, c.get("me"), input);
    return c.json({ ok: true });
  });

  // An empty seat's target: whoever takes the seat takes it.
  app.post("/api/targets/seat", async (c) => {
    const input = await readBody(
      c,
      z.object({
        seatId: z.number().int().positive(),
        month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick the month."),
        amount: z.number().int().min(0).max(100_000_000_000).nullable(),
      }),
    );
    await setSeatTarget(db, c.get("me"), input);
    return c.json({ ok: true });
  });
  app.post("/api/targets/copy", async (c) => {
    const input = await readBody(c, z.object({ month: z.string() }));
    return c.json(await copyLastTargets(db, c.get("me"), input.month));
  });
}
