// Complaints and side-effects: report, list, handle.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, idParam, readBody } from "../http";
import { listComplaints, reportComplaint, updateComplaint } from "./service";

const id = z.number().int().positive().nullish();
const words = (max: number) => z.string().trim().max(max).nullish();

export function complaintRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/complaints", signedIn);
  app.use("/api/complaints/*", signedIn);
  app.get("/api/complaints", async (c) => c.json(await listComplaints(db, c.get("me"), { view: c.req.query("view") })));
  app.post("/api/complaints", async (c) => {
    const input = await readBody(
      c,
      z.object({
        kind: z.enum(["quality", "side_effect", "delivery", "service", "other"], { error: "Pick what it is about." }),
        serious: z.boolean().optional(),
        customerId: id,
        patientName: words(120),
        medicineId: id,
        batchNo: words(60),
        orderId: id,
        description: z.string().trim().max(3000),
        receivedOn: words(10),
      }),
    );
    return c.json(await reportComplaint(db, c.get("me"), input));
  });
  app.post("/api/complaints/:id", async (c) => {
    const input = await readBody(
      c,
      z.object({
        status: z.enum(["open", "investigating", "closed"]).optional(),
        note: words(1000),
        ownerId: z.number().int().positive().nullable().optional(),
        dueOn: words(10),
        fdaRef: words(80),
        outcome: words(1000),
      }),
    );
    await updateComplaint(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
}
