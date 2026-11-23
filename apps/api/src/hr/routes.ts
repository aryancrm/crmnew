// HR's addresses: attendance today and by month, Start / End my day, HR putting a day right, and
// HR's people (records, new joiners with the login HR typed, logins, leaving).

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, idParam, Refusal, readBody } from "../http";
import type { LeaveKind } from "../types";
import {
  attendanceMonth,
  attendanceReport,
  attendanceToday,
  endDay,
  myDay,
  putDayRight,
  recordLeave,
  startDay,
  workCalendar,
} from "./attendance";
import { cancelForm, decideForm, formList, myForms, requestForm } from "./forms";
import {
  cancelLeave,
  decideLeave,
  LEAVE_FILE_MAX_BYTES,
  type LeaveFile,
  leaveFile,
  leaveList,
  myLeave,
  requestLeave,
} from "./leave";
import {
  addAdjustment,
  myPayslips,
  payRules,
  payrollList,
  payrollMonth,
  payslipOf,
  registerCsv,
  releaseMonth,
  removeAdjustment,
} from "./payroll";
import {
  addJoiner,
  hrPeople,
  hrPerson,
  joinerForm,
  markLeft,
  personBack,
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
  // Looking as someone shows their work, not their private record: pay, bank, government numbers,
  // birth date, contact, a medical certificate. A team lead or a head gets none of it that way; the
  // CEO and the Admin read these on their own login anyway.
  for (const path of ["/api/hr/people/*", "/api/hr/payslips/*", "/api/hr/payroll/*", "/api/hr/leave/:id/file"])
    app.use(path, async (c, next) => {
      const viewer = c.get("me").viewedBy;
      if (viewer && viewer.role !== "ceo" && viewer.role !== "admin")
        throw new Refusal(403, "private", "Pay and personal records are private: looking as someone doesn't open them.");
      await next();
    });
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
  app.get("/api/hr/leave/mine", async (c) =>
    c.json(await myLeave(db, c.get("me"), Number(c.req.query("year")) || null)),
  );
  app.get("/api/hr/leave/list", async (c) =>
    c.json(
      await leaveList(db, c.get("me"), { view: c.req.query("view"), month: c.req.query("month") }),
    ),
  );
  // A request with an optional paper: a form with its fields as text and the paper as `file`.
  app.post("/api/hr/leave/request", async (c) => {
    if (Number(c.req.header("content-length") ?? 0) > LEAVE_FILE_MAX_BYTES + 64 * 1024)
      throw new Refusal(400, "invalid", "That file is over 10 MB. Take the photo again.", "file");
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const text = (key: string) =>
      typeof body[key] === "string" ? (body[key] as string).trim() : "";
    const file = body.file;
    const paper: LeaveFile | null =
      file instanceof File && file.size > 0
        ? { name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }
        : null;
    return c.json(
      await requestLeave(
        db,
        c.get("me"),
        {
          kind: text("kind") as LeaveKind,
          from: text("from"),
          to: text("to") || text("from"),
          halfDay: text("halfDay") === "true",
          reason: text("reason") || null,
        },
        paper,
      ),
    );
  });
  app.post("/api/hr/leave/:id/decide", async (c) => {
    const input = await readBody(c, z.object({ approve: z.boolean(), note: words(300) }));
    await decideLeave(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.get("/api/hr/leave/:id/file", async (c) => {
    const paper = await leaveFile(db, c.get("me"), idParam(c));
    return c.body(paper.bytes as Uint8Array<ArrayBuffer>, 200, {
      "content-type": paper.mime,
      "content-disposition": `inline; filename="${encodeURIComponent(paper.name)}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=604800, immutable",
    });
  });
  app.get("/api/hr/forms/mine", async (c) => c.json({ lines: await myForms(db, c.get("me")) }));
  app.get("/api/hr/forms/list", async (c) =>
    c.json(
      await formList(db, c.get("me"), { view: c.req.query("view"), month: c.req.query("month") }),
    ),
  );
  app.post("/api/hr/forms", async (c) => {
    const input = await readBody(
      c,
      z.object({
        kind: z.enum(["ob", "wfh", "ot"], { message: "Pick the form." }),
        day,
        from: z.string().max(5).nullish(),
        to: z.string().max(5).nullish(),
        place: words(200),
        reason: z.string().max(300),
      }),
    );
    return c.json(await requestForm(db, c.get("me"), input));
  });
  app.post("/api/hr/forms/:id/decide", async (c) => {
    const input = await readBody(c, z.object({ approve: z.boolean(), note: words(300) }));
    await decideForm(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.post("/api/hr/forms/:id/cancel", async (c) => {
    await cancelForm(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
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
          noSss: z.boolean(),
          noPhilhealth: z.boolean(),
          noPagibig: z.boolean(),
          noTax: z.boolean(),
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
  app.post("/api/hr/people/:id/back", async (c) => {
    await personBack(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
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

  // Payroll, one a month: HR works it and releases it; the CEO reads; each person reads their own.
  app.get("/api/hr/payroll", async (c) => c.json(await payrollList(db, c.get("me"))));
  app.get("/api/hr/payroll/rules", async (c) => c.json(await payRules(db, c.get("me"))));
  app.get("/api/hr/payroll/:month", async (c) =>
    c.json(await payrollMonth(db, c.get("me"), c.req.param("month"))),
  );
  app.get("/api/hr/payroll/:month/register.csv", async (c) => {
    const { name, csv } = await registerCsv(db, c.get("me"), c.req.param("month"));
    return c.body(csv, 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
    });
  });
  app.get("/api/hr/payroll/:month/slip/:id", async (c) =>
    c.json(await payslipOf(db, c.get("me"), c.req.param("month"), idParam(c))),
  );
  app.post("/api/hr/payroll/:month/lines", async (c) => {
    const input = await readBody(
      c,
      z.object({
        personId: z.number().int().positive("Pick the person."),
        label: z.string().max(80),
        kind: z.enum(["earning", "deduction"], { message: "Pick whether it adds or takes off." }),
        taxable: z.boolean().nullish(),
        amount: z.number().int("Type whole centavos."),
        note: words(300),
      }),
    );
    return c.json(
      await addAdjustment(db, c.get("me"), c.req.param("month"), {
        ...input,
        taxable: input.taxable ?? true,
      }),
    );
  });
  app.post("/api/hr/payroll/lines/:id/remove", async (c) => {
    await removeAdjustment(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });
  app.post("/api/hr/payroll/:month/release", async (c) =>
    c.json(await releaseMonth(db, c.get("me"), c.req.param("month"))),
  );
  app.get("/api/hr/payslips/mine", async (c) => c.json(await myPayslips(db, c.get("me"))));
  app.get("/api/hr/payslips/:month", async (c) =>
    c.json(await payslipOf(db, c.get("me"), c.req.param("month"))),
  );
}
