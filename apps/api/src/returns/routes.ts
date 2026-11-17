// Returns' addresses. The service checks who may do what.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, idParam, Refusal, readBody } from "../http";
import type { ReturnGoods, ReturnReason } from "../types";
import {
  cancelReturn,
  creditReturn,
  decideReturn,
  listReturns,
  mayReadReturnOrder,
  orderReturns,
  RETURN_GOODS,
  RETURN_REASONS,
  receiveReturn,
  requestReturn,
} from "./service";

export function returnRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/returns", signedIn);
  app.use("/api/returns/*", signedIn);

  app.get("/api/returns", async (c) =>
    c.json(await listReturns(db, c.get("me"), { status: c.req.query("status") })),
  );
  app.get("/api/orders/:id/returns", signedIn, async (c) => {
    const me = c.get("me");
    if (!(await mayReadReturnOrder(db, me, idParam(c))))
      throw new Refusal(404, "not_found", "That order isn't one of yours, or it doesn't exist.");
    return c.json(await orderReturns(db, me, idParam(c)));
  });
  app.post("/api/orders/:id/returns", signedIn, async (c) => {
    const input = await readBody(
      c,
      z.object({
        reason: z.enum(RETURN_REASONS as [ReturnReason, ...ReturnReason[]], {
          error: "Say why it comes back.",
        }),
        goods: z.enum(RETURN_GOODS as [ReturnGoods, ...ReturnGoods[]]).optional(),
        note: z.string().trim().max(500).nullish(),
        // Not shipped yet: none (the whole order); otherwise the service asks for some.
        lines: z
          .array(
            z.object({
              orderItemId: z.number().int().positive(),
              qty: z.number({ error: "Type how many." }).int("Use whole pieces.").min(0),
            }),
          )
          .max(40)
          .default([]),
      }),
    );
    return c.json({ id: await requestReturn(db, c.get("me"), idParam(c), input) });
  });
  app.post("/api/returns/:id/decide", async (c) => {
    const input = await readBody(
      c,
      z.object({ approve: z.boolean(), note: z.string().trim().max(500).nullish() }),
    );
    await decideReturn(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.post("/api/returns/:id/receive", async (c) => {
    const input = await readBody(
      c,
      z.object({
        lines: z
          .array(
            z.object({
              lineId: z.number().int().positive(),
              outcome: z.enum(["restocked", "damaged", "missing"]),
            }),
          )
          .min(1),
      }),
    );
    return c.json(await receiveReturn(db, c.get("me"), idParam(c), input));
  });
  app.post("/api/returns/:id/credit", async (c) => {
    const input = await readBody(
      c,
      z.object({ credit: z.boolean(), note: z.string().trim().max(500).nullish() }),
    );
    await creditReturn(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.post("/api/returns/:id/cancel", async (c) => {
    await cancelReturn(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });
}
