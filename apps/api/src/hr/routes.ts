// HR's addresses: attendance today and by month, Start / End my day, HR putting a day right, and
// HR's people (records, new joiners with the login HR typed, logins, leaving).

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, idParam, readBody } from "../http";
import {
  attendanceMonth,
  attendanceReport,
  attendanceToday,
  cancelLeave,
  endDay,
  myDay,
  putDayRight,
  recordLeave,
  startDay,
  workCalendar,
} from "./attendance";
import {
  addJoiner,
  hrPeople,
  hrPerson,
  joinerForm,
  markLeft,
  setLogin,
  updateRecord,
} from "./people";

const place = z.object({ place: z.string().trim().max(200).nullish() });
const clock = z.string().regex(/^\d{2}:\d{2}$/, "Type the time as 08:30.");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day.");
const words = (max: number) => z.string().max(max).nullish();
const pesos = z.number().int("Type whole centavos.").min(0).nullish();
const company = z.enum(["2mg", "gpi"], { message: "Pick the company." });
const classification = z.enum(["probationary", "regular", "part_time", "intern"], {
  message: "Pick how they are employed.",
});

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
  // Before /:id, so "report" is never read as an id.
  app.get("/api/hr/attendance/report", async (c) =>
    c.json(
      await attendanceReport(db, c.get("me"), { from: c.req.query("from"), to: c.req.query("to") }),
    ),
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
  app.post("/api/hr/leave", async (c) => {
    const input = await readBody(
      c,
      z.object({
        personId: z.number().int().positive(),
        kind: z.enum(["vl", "sl", "lwop", "other"], { message: "Pick the kind of leave." }),
        from: day,
        to: day,
        halfDay: z.boolean().optional(),
        reason: words(300),
      }),
    );
    return c.json(await recordLeave(db, c.get("me"), input));
  });
  app.post("/api/hr/leave/:id/cancel", async (c) => {
    await cancelLeave(db, c.get("me"), idParam(c));
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

  app.get("/api/hr/people", async (c) =>
    c.json(await hrPeople(db, c.get("me"), { q: c.req.query("q"), stage: c.req.query("stage") })),
  );
  app.get("/api/hr/people/:id", async (c) => c.json(await hrPerson(db, c.get("me"), idParam(c))));
  app.patch("/api/hr/people/:id", async (c) => {
    const input = await readBody(
      c,
      z
        .object({
          company,
          employeeCode: words(40),
          classification,
          position: words(120),
          department: words(120),
          hireDate: day,
          regularizedOn: day.nullish(),
          mobile: words(30),
          personalEmail: words(200),
          birthDate: day.nullish(),
          address: words(400),
          emergencyName: words(120),
          emergencyPhone: words(30),
          emergencyRelation: words(60),
          salary: pesos,
          allowance: pesos,
          bankName: words(120),
          bankAccount: words(60),
          sss: words(40),
          philhealth: words(40),
          pagibig: words(40),
          tin: words(40),
        })
        .partial(),
    );
    await updateRecord(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.post("/api/hr/people/:id/login", async (c) => {
    const input = await readBody(
      c,
      z.object({ email: words(200), password: z.string().max(200).nullish() }),
    );
    return c.json(await setLogin(db, c.get("me"), idParam(c), input));
  });
  app.post("/api/hr/people/:id/left", async (c) => {
    const input = await readBody(c, z.object({ lastDay: day.nullish(), reason: words(300) }));
    return c.json(await markLeft(db, c.get("me"), idParam(c), input));
  });
  app.get("/api/hr/joiners/form", async (c) => c.json(await joinerForm(db, c.get("me"))));
  app.post("/api/hr/joiners", async (c) => {
    const input = await readBody(
      c,
      z.object({
        name: z.string().max(120),
        mobile: z.string().max(30),
        company,
        employeeCode: words(40),
        seatId: z.number().int().positive("Pick the seat they join."),
        startsOn: z.string().max(10),
        classification,
        position: words(120),
        salary: pesos,
        allowance: pesos,
        loginEmail: z.string().max(200),
        password: z.string().max(200),
      }),
    );
    return c.json(await addJoiner(db, c.get("me"), input));
  });
}
