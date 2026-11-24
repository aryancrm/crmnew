// HR's addresses: attendance today and by month, Start / End my day, HR putting a day right, and
// HR's people (records, new joiners with the login HR typed, logins, leaving).

import type { Context, Hono, MiddlewareHandler } from "hono";
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
import { cancelFix, decideFix, fixList, myFixes, requestFix } from "./corrections";
import {
  addCredit,
  leaveCredits,
  reverseCredit,
  setSecondApprover,
  vlConversionReport,
} from "./credits";
import { hrHistory } from "./events";
import { addSchedule, archiveSchedule, hrSchedules, setPersonSchedule } from "./schedules";
import {
  cancelForm,
  decideForm,
  formList,
  myForms,
  requestForm,
  resendForm,
  returnForm,
  revokeForm,
} from "./forms";
import { formPrintout, leavePrintout, mySignature, SIGNATURE_MAX_BYTES, saveSignature } from "./print";
import { hrQueue } from "./queue";
import { addPosition, hrPositions, setPositionArchived } from "./positions";
import { addPaper, archivePaper, hrPapers, PAPER_MAX_BYTES, type PaperFile, paperFile } from "./papers";
import {
  archiveDevice,
  dismissBiometric,
  importFile,
  importTimekeeping,
  previewTimekeeping,
  setDevice,
  TIMEKEEPING_MAX_BYTES,
  type TimekeepingFile,
  timekeepingPage,
  useBiometric,
} from "./timekeeping";
import {
  cancelLeave,
  decideLeave,
  LEAVE_FILE_MAX_BYTES,
  type LeaveFile,
  leaveFile,
  leaveList,
  leaveProof,
  myLeave,
  requestLeave,
  revokeLeave,
} from "./leave";
import { LEAVE_FILES_MAX } from "./leave-rules";
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
  for (const path of [
    "/api/hr/people/*",
    "/api/hr/papers/*",
    "/api/hr/payslips/*",
    "/api/hr/payroll/*",
    "/api/hr/leave/:id/file",
    "/api/hr/leave/:id/files/*",
    "/api/hr/leave/conversion",
    "/api/hr/credits/*",
    "/api/hr/print/*",
    "/api/hr/signature",
    "/api/hr/timekeeping",
    "/api/hr/timekeeping/*",
  ])
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
  // A request with up to five papers: a form with its fields as text and each paper as `file`.
  app.post("/api/hr/leave/request", async (c) => {
    if (Number(c.req.header("content-length") ?? 0) > LEAVE_FILES_MAX * LEAVE_FILE_MAX_BYTES + 64 * 1024)
      throw new Refusal(400, "invalid", "The files are over 10 MB each. Take the photos again.", "file");
    const body = await c.req
      .parseBody({ all: true })
      .catch(() => ({}) as Record<string, unknown>);
    const text = (key: string) =>
      typeof body[key] === "string" ? (body[key] as string).trim() : "";
    const sent = body.file;
    const paper: LeaveFile[] = [];
    for (const file of Array.isArray(sent) ? sent : [sent])
      if (file instanceof File && file.size > 0)
        paper.push({ name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
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
  app.get("/api/hr/leave/:id/files/:fileId", async (c) => {
    const paper = await leaveProof(db, c.get("me"), idParam(c), idParam(c, "fileId"));
    return c.body(paper.bytes as Uint8Array<ArrayBuffer>, 200, {
      "content-type": paper.mime,
      "content-disposition": `inline; filename="${encodeURIComponent(paper.name)}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=604800, immutable",
    });
  });
  app.post("/api/hr/leave/:id/revoke", async (c) => {
    const input = await readBody(c, z.object({ reason: words(300) }));
    await revokeLeave(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  // Year-end: unused vacation leave and the half that converts to pay (a report, nothing paid).
  app.get("/api/hr/leave/conversion", async (c) =>
    c.json(await vlConversionReport(db, c.get("me"), Number(c.req.query("year")) || null)),
  );
  // A person's credits: the ledger, HR's adjustments (never changed: reversed), the second approver.
  app.get("/api/hr/people/:id/credits", async (c) =>
    c.json(await leaveCredits(db, c.get("me"), idParam(c), Number(c.req.query("year")) || null)),
  );
  app.post("/api/hr/people/:id/credits", async (c) => {
    const input = await readBody(
      c,
      z.object({
        year: z.number().int().nullish(),
        kind: z.enum(["vl", "sl"], { message: "Pick vacation or sick leave." }),
        days: z.number({ message: "Type the days." }),
        reason: words(300),
      }),
    );
    return c.json(await addCredit(db, c.get("me"), idParam(c), input));
  });
  app.post("/api/hr/credits/:id/reverse", async (c) => {
    const input = await readBody(c, z.object({ reason: words(300) }));
    return c.json(await reverseCredit(db, c.get("me"), idParam(c), input));
  });
  app.post("/api/hr/people/:id/second-approver", async (c) => {
    const input = await readBody(c, z.object({ personId: z.number().int().positive().nullable() }));
    await setSecondApprover(db, c.get("me"), idParam(c), input.personId);
    return c.json({ ok: true });
  });
  // Everything waiting on this decider under Leave & forms, by kind.
  app.get("/api/hr/queue", async (c) => c.json(await hrQueue(db, c.get("me"))));
  // Each person's drawn signature, and the printouts that carry the signers' signatures.
  app.get("/api/hr/signature", async (c) => c.json(await mySignature(db, c.get("me"))));
  app.post("/api/hr/signature", async (c) => {
    if (Number(c.req.header("content-length") ?? 0) > SIGNATURE_MAX_BYTES + 64 * 1024)
      throw new Refusal(400, "invalid", "The signature image is over 1 MB.", "file");
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const file = body.file;
    return c.json(
      await saveSignature(
        db,
        c.get("me"),
        file instanceof File && file.size > 0
          ? { name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }
          : null,
      ),
    );
  });
  app.get("/api/hr/print/leave/:id", async (c) => c.json(await leavePrintout(db, c.get("me"), idParam(c))));
  app.get("/api/hr/print/form/:id", async (c) => c.json(await formPrintout(db, c.get("me"), idParam(c))));
  app.get("/api/hr/forms/mine", async (c) => c.json({ lines: await myForms(db, c.get("me")) }));
  app.get("/api/hr/forms/list", async (c) =>
    c.json(
      await formList(db, c.get("me"), { view: c.req.query("view"), month: c.req.query("month") }),
    ),
  );
  const activity = z.object({
    timeIn: z.string().max(5),
    timeOut: z.string().max(5),
    location: words(200),
    details: z.string().max(2000),
    deadline: words(200),
    remarks: words(500),
  });
  const formBody = z.object({
    kind: z.enum(["ob", "wfh", "ot", "eod", "incident"], { message: "Pick the form." }),
    day,
    from: z.string().max(5).nullish(),
    to: z.string().max(5).nullish(),
    place: words(200),
    reason: z.string().max(5000),
    otType: z
      .enum(["regular", "rest", "legal", "special", "rest_legal", "rest_special", "broken"], {
        message: "Pick the type of overtime.",
      })
      .nullish(),
    forPersonId: z.number().int().positive().nullish(),
    activities: z.array(activity).max(31).nullish(),
    incident: z
      .object({
        time: z.string().max(5),
        location: z.string().max(200),
        type: z.enum(["Safety / Accident", "Misconduct", "Property Damage", "Security", "Other"], {
          message: "Pick the kind of incident.",
        }),
        otherText: words(120),
        persons: z.string().max(5000),
        action: z.string().max(5000),
      })
      .nullish(),
  });
  app.post("/api/hr/forms", async (c) => {
    const input = await readBody(c, formBody);
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
  app.post("/api/hr/forms/:id/revoke", async (c) => {
    await revokeForm(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });
  app.post("/api/hr/forms/:id/return", async (c) => {
    const input = await readBody(c, z.object({ note: words(300) }));
    await returnForm(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.post("/api/hr/forms/:id/resend", async (c) => {
    const input = await readBody(c, formBody);
    await resendForm(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  // Asking for a day of one's own attendance to be put right; whom they report to (or HR) decides.
  app.get("/api/hr/fixes/mine", async (c) => c.json({ lines: await myFixes(db, c.get("me")) }));
  app.get("/api/hr/fixes/list", async (c) =>
    c.json(
      await fixList(db, c.get("me"), { view: c.req.query("view"), month: c.req.query("month") }),
    ),
  );
  app.post("/api/hr/fixes", async (c) => {
    const input = await readBody(
      c,
      z.object({ day, timeIn: clock, timeOut: clock.nullish(), reason: z.string().max(300) }),
    );
    return c.json(await requestFix(db, c.get("me"), input));
  });
  app.post("/api/hr/fixes/:id/decide", async (c) => {
    const input = await readBody(c, z.object({ approve: z.boolean(), note: words(300) }));
    await decideFix(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.post("/api/hr/fixes/:id/cancel", async (c) => {
    await cancelFix(db, c.get("me"), idParam(c));
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
  app.get("/api/hr/people/:id/history", async (c) =>
    c.json(await hrHistory(db, c.get("me"), idParam(c))),
  );
  app.get("/api/hr/positions", async (c) => c.json(await hrPositions(db, c.get("me"))));
  app.post("/api/hr/positions", async (c) => {
    const input = await readBody(c, z.object({ name: z.string().max(200) }));
    return c.json(await addPosition(db, c.get("me"), input));
  });
  app.post("/api/hr/positions/:id", async (c) => {
    const input = await readBody(c, z.object({ archived: z.boolean() }));
    await setPositionArchived(db, c.get("me"), idParam(c), input.archived);
    return c.json({ ok: true });
  });
  // Work schedules: HR gives people a shift, or the company's default.
  app.get("/api/hr/schedules", async (c) => c.json(await hrSchedules(db, c.get("me"))));
  app.post("/api/hr/schedules", async (c) => {
    const input = await readBody(
      c,
      z.object({
        name: z.string().max(200),
        days: z.array(z.number().int().min(0).max(6)).max(7),
        start: clock,
        end: clock,
        graceMinutes: z.number().int().nullish(),
        breakMinutes: z.number().int().nullish(),
      }),
    );
    return c.json(await addSchedule(db, c.get("me"), input));
  });
  app.post("/api/hr/schedules/:id/archive", async (c) => {
    await archiveSchedule(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });
  app.post("/api/hr/people/:id/schedule", async (c) => {
    const input = await readBody(c, z.object({ scheduleId: z.number().int().positive().nullable() }));
    await setPersonSchedule(db, c.get("me"), idParam(c), input.scheduleId);
    return c.json({ ok: true });
  });
  // The biometric timekeeping workbook: HR previews it (nothing kept), confirms who rows are,
  // imports it, and answers Needs review; the CEO reads.
  const workbookOf = async (c: Context<Env>): Promise<TimekeepingFile | null> => {
    if (Number(c.req.header("content-length") ?? 0) > TIMEKEEPING_MAX_BYTES + 64 * 1024)
      throw new Refusal(400, "invalid", "That file is over 10 MB.", "file");
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const file = body.file;
    return file instanceof File && file.size > 0
      ? { name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }
      : null;
  };
  app.get("/api/hr/timekeeping", async (c) =>
    c.json(await timekeepingPage(db, c.get("me"), { from: c.req.query("from"), to: c.req.query("to") })),
  );
  app.post("/api/hr/timekeeping/preview", async (c) =>
    c.json(await previewTimekeeping(db, c.get("me"), await workbookOf(c))),
  );
  app.post("/api/hr/timekeeping/import", async (c) =>
    c.json(await importTimekeeping(db, c.get("me"), await workbookOf(c))),
  );
  app.get("/api/hr/timekeeping/imports/:id/file", async (c) => {
    const file = await importFile(db, c.get("me"), idParam(c));
    return c.body(file.bytes as Uint8Array<ArrayBuffer>, 200, {
      "content-type": file.mime,
      "content-disposition": `attachment; filename="${encodeURIComponent(file.name)}"`,
      "x-content-type-options": "nosniff",
    });
  });
  app.post("/api/hr/timekeeping/devices", async (c) => {
    const input = await readBody(
      c,
      z.object({
        deviceId: z.string().trim().min(1, "The row needs its device ID.").max(40),
        personId: z.number().int().positive(),
        nameOnSheet: words(120),
      }),
    );
    return c.json(await setDevice(db, c.get("me"), input));
  });
  app.post("/api/hr/timekeeping/devices/:id/archive", async (c) => {
    await archiveDevice(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });
  app.post("/api/hr/timekeeping/days/:id/use", async (c) => {
    const input = await readBody(c, z.object({ note: words(200) }));
    await useBiometric(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.post("/api/hr/timekeeping/days/:id/dismiss", async (c) => {
    const input = await readBody(c, z.object({ note: words(300) }));
    await dismissBiometric(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.get("/api/hr/people/:id/papers", async (c) =>
    c.json(await hrPapers(db, c.get("me"), idParam(c))),
  );
  // A paper: a form with kind, title, expiresOn as text and the paper as `file`.
  app.post("/api/hr/people/:id/papers", async (c) => {
    if (Number(c.req.header("content-length") ?? 0) > PAPER_MAX_BYTES + 64 * 1024)
      throw new Refusal(400, "invalid", "That file is over 10 MB.", "file");
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string).trim() : "");
    const file = body.file;
    const paper: PaperFile | null =
      file instanceof File && file.size > 0
        ? { name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }
        : null;
    return c.json(
      await addPaper(
        db,
        c.get("me"),
        idParam(c),
        { kind: text("kind"), title: text("title"), expiresOn: text("expiresOn") || null },
        paper,
      ),
    );
  });
  app.post("/api/hr/papers/:id/archive", async (c) => {
    const input = await readBody(c, z.object({ reason: words(300) }));
    await archivePaper(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.get("/api/hr/papers/:id/file", async (c) => {
    const paper = await paperFile(db, c.get("me"), idParam(c));
    return c.body(paper.bytes as Uint8Array<ArrayBuffer>, 200, {
      "content-type": paper.mime,
      "content-disposition": `inline; filename="${encodeURIComponent(paper.name)}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=604800, immutable",
    });
  });
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
          gender: z.enum(["female", "male"], { message: "Pick one from the list." }).nullish(),
          civilStatus: z
            .enum(["single", "married", "widowed", "separated"], { message: "Pick one from the list." })
            .nullish(),
          citizenship: words(60),
          spouseName: words(120),
          fatherName: words(120),
          motherName: words(120),
          education: words(120),
          school: words(160),
          course: words(160),
          workArrangement: z
            .enum(["office", "field", "hybrid", "remote"], { message: "Pick one from the list." })
            .nullish(),
          companyPhone: words(30),
          issuedEquipment: words(500),
          jobDescription: words(2000),
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
