// The field's addresses: a person's visits on a day, the visit forms' lists, planning, check in,
// the call report, skip and move, and the visits report.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, idParam, readBody } from "../http";
import {
  checkIn,
  fieldDay,
  fieldForm,
  fieldReport,
  moveVisit,
  planVisit,
  reportVisit,
  skipVisit,
} from "./visits";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day.");
const words = (max: number) => z.string().max(max).nullish();

export function fieldRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>) {
  app.use("/api/field/*", signedIn);
  app.get("/api/field/day", async (c) =>
    c.json(
      await fieldDay(db, c.get("me"), {
        day: c.req.query("day"),
        person: Number(c.req.query("person")) || null,
      }),
    ),
  );
  app.get("/api/field/form", async (c) =>
    c.json(await fieldForm(db, c.get("me"), c.req.query("q"))),
  );
  app.get("/api/field/report", async (c) =>
    c.json(
      await fieldReport(db, c.get("me"), { from: c.req.query("from"), to: c.req.query("to") }),
    ),
  );
  app.post("/api/field/visits", async (c) => {
    const input = await readBody(
      c,
      z.object({
        customerId: z.number().int().positive("Pick whom you visit."),
        day,
        objective: words(300),
      }),
    );
    return c.json(await planVisit(db, c.get("me"), input));
  });
  app.post("/api/field/visits/:id/check-in", async (c) => {
    const input = await readBody(c, z.object({ place: words(60) }));
    await checkIn(db, c.get("me"), idParam(c), input.place);
    return c.json({ ok: true });
  });
  app.post("/api/field/visits/:id/report", async (c) => {
    const input = await readBody(
      c,
      z.object({
        objective: words(300),
        detailed: z
          .array(
            z.object({
              medicineId: z.number().int().positive(),
              reaction: z.enum(["will_prescribe", "prescribes", "needs_info", "not_interested"], {
                message: "Say how the doctor took it.",
              }),
            }),
          )
          .max(20),
        notes: words(1000),
        nextDay: day.nullish(),
      }),
    );
    return c.json(await reportVisit(db, c.get("me"), idParam(c), input));
  });
  app.post("/api/field/visits/:id/skip", async (c) => {
    const input = await readBody(
      c,
      z.object({
        reason: z.enum(
          ["not_available", "busy", "clinic_closed", "out_of_town", "rescheduled", "other"],
          { message: "Pick why it didn't happen." },
        ),
        note: words(300),
      }),
    );
    await skipVisit(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.post("/api/field/visits/:id/move", async (c) => {
    const input = await readBody(c, z.object({ day }));
    await moveVisit(db, c.get("me"), idParam(c), input.day);
    return c.json({ ok: true });
  });
}
