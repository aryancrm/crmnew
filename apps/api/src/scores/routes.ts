// Scorecards' addresses: my card (or one of my team's), the team's cards, questions on a locked
// month, and the Admin locking a month again after a figure was put right at its source.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, Refusal, readBody } from "../http";
import { todayManila } from "../inventory/rules";
import { answerDispute, lockMonth, myScore, raiseDispute, teamScores } from "./service";

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick the month.");

export function scoreRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/scores/*", signedIn);
  app.use("/api/scores", signedIn);

  app.get("/api/scores", async (c) => {
    const personId = Number(c.req.query("personId"));
    return c.json(
      await myScore(db, c.get("me"), {
        month: c.req.query("month"),
        personId: Number.isInteger(personId) && personId > 0 ? personId : undefined,
      }),
    );
  });

  app.get("/api/scores/team", async (c) => {
    const unitId = Number(c.req.query("unitId"));
    return c.json(
      await teamScores(db, c.get("me"), {
        month: c.req.query("month"),
        // The box picked on the team switch (?unit=, checked when signing the request in).
        unitId: c.get("me").unit ?? (Number.isInteger(unitId) && unitId > 0 ? unitId : null),
      }),
    );
  });

  app.post("/api/scores/disputes", async (c) => {
    const input = await readBody(
      c,
      z.object({ month: MONTH, kpi: z.string().min(1), note: z.string().trim().min(5, "Say what looks wrong.").max(1000) }),
    );
    return c.json(await raiseDispute(db, c.get("me"), input));
  });

  app.post("/api/scores/disputes/:id/answer", async (c) => {
    const input = await readBody(
      c,
      z.object({ upheld: z.boolean(), answer: z.string().trim().min(2, "Write the answer.").max(1000) }),
    );
    await answerDispute(db, c.get("me"), Number(c.req.param("id")), input);
    return c.json({ ok: true });
  });

  app.post("/api/scores/lock", async (c) => {
    const me = c.get("me");
    if (me.role !== "admin") throw new Refusal(403, "not_allowed", "Only the Admin locks a month again.");
    const input = await readBody(c, z.object({ month: MONTH }));
    if (input.month >= todayManila().slice(0, 7))
      throw new Refusal(400, "invalid", "A month is locked once it is over.", "month");
    return c.json({ locked: await lockMonth(db, input.month, true) });
  });
}
