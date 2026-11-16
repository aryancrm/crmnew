// B2B Telesales: the NBD's and the CRR's desks, calls, papers, hand-overs, the coach's team.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, readBody } from "../http";
import { addProspect, b2bTeam, crrDay, handOver, logCall, nbdDay, savePapers } from "./service";

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day.");

export function b2bRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/b2b/*", signedIn);
  app.get("/api/b2b/nbd", async (c) => c.json(await nbdDay(db, c.get("me"))));
  app.get("/api/b2b/crr", async (c) => c.json(await crrDay(db, c.get("me"))));
  app.get("/api/b2b/team", async (c) => c.json(await b2bTeam(db, c.get("me"))));
  app.post("/api/b2b/prospects", async (c) => {
    const input = await readBody(
      c,
      z.object({
        customerId: z.number().int().positive().nullish(),
        customer: z
          .object({
            kind: z.enum(["drugstore", "distributor", "hospital"]),
            name: z.string().trim().min(2, "Type the business's name."),
            phone: z.string().trim().nullish(),
            city: z.string().trim().nullish(),
            address: z.string().trim().nullish(),
          })
          .nullish(),
      }),
    );
    return c.json(await addProspect(db, c.get("me"), input));
  });
  app.post("/api/b2b/calls", async (c) => {
    const input = await readBody(
      c,
      z.object({
        customerId: z.number().int().positive(),
        outcome: z.enum(["reached", "no_answer", "call_back", "ordered", "not_interested", "won_back"]),
        note: z.string().max(500).nullish(),
        nextOn: DAY.nullish(),
      }),
    );
    await logCall(db, c.get("me"), input);
    return c.json({ ok: true });
  });
  app.post("/api/b2b/papers", async (c) => {
    const input = await readBody(
      c,
      z.object({
        customerId: z.number().int().positive(),
        licenceNo: z.string().max(80).nullish(),
        licenceExpires: DAY.nullish(),
        permitNo: z.string().max(80).nullish(),
        permitExpires: DAY.nullish(),
        tin: z.string().max(40).nullish(),
      }),
    );
    await savePapers(db, c.get("me"), input);
    return c.json({ ok: true });
  });
  app.post("/api/b2b/hand-over", async (c) => {
    const input = await readBody(c, z.object({ customerId: z.number().int().positive(), crrId: z.number().int().positive() }));
    await handOver(db, c.get("me"), input);
    return c.json({ ok: true });
  });
}
