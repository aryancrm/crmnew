// HR's addresses: attendance today and by month, Start / End my day, and HR putting a day right.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, idParam, readBody } from "../http";
import {
  attendanceMonth,
  attendanceToday,
  endDay,
  myDay,
  putDayRight,
  startDay,
  workCalendar,
} from "./attendance";

const place = z.object({ place: z.string().trim().max(200).nullish() });
const clock = z.string().regex(/^\d{2}:\d{2}$/, "Type the time as 08:30.");

export function hrRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>) {
  app.use("/api/hr/*", signedIn);
  // The company's working hours and holidays: every screen's desk clock runs on them.
  app.get("/api/hr/calendar", async (c) => {
    const { schedule, holidays } = await workCalendar(db);
    return c.json({ schedule, holidays: [...holidays] });
  });
  app.get("/api/hr/my-day", async (c) => c.json(await myDay(db, c.get("me"))));
  app.get("/api/hr/attendance", async (c) =>
    c.json(await attendanceToday(db, c.get("me"), c.req.query("day"))),
  );
  app.get("/api/hr/attendance/:id", async (c) =>
    c.json(await attendanceMonth(db, c.get("me"), idParam(c), c.req.query("month"))),
  );
  app.post("/api/hr/attendance/:id", async (c) => {
    const input = await readBody(
      c,
      z.object({
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day."),
        timeIn: clock,
        timeOut: clock.nullable(),
        note: z.string().trim().max(300),
      }),
    );
    await putDayRight(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.post("/api/hr/day/start", async (c) => {
    const input = await readBody(c, place);
    await startDay(db, c.get("me"), input.place);
    return c.json({ ok: true });
  });
  app.post("/api/hr/day/end", async (c) => {
    const input = await readBody(c, place);
    await endDay(db, c.get("me"), input.place);
    return c.json({ ok: true });
  });
}
