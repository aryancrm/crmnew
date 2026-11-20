// The field's addresses (/api/mr/*, docs/PLAN.md 22: SEFMED's work in the MedRep's pages): the MR's
// day, visits and calls, customers' field pages and profiles, follow-ups, the tour plan, expenses;
// the lead's team, queue, approvals and reports. Every one checks who is asking (access.ts) from
// the company's own hierarchy; a hidden button is never the only guard.

import type { Context, Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import type { IncomingFile } from "../files/store";
import { type Env, idParam, Refusal, readBody } from "../http";
import { answerOffList, askOffList, callHistory, clientList, clientPage, clientsIn, fieldCities, offRequests, saveProfile } from "./clients";
import { changePlace, dayReport, mrHome, seeDayReport, sendDayReport, startWorking, takeBreak } from "./day";
import { addExpense, claimExpense, decideExpense, EXPENSE_FILE_MAX, expenseFile, expenseMonth, setRates } from "./expenses";
import { addFollowUp, closeFollowUp, followUpList } from "./follow-ups";
import { decideDeviation, decidePlan, deviationList, planMonth, sendPlan, setPlanDay, teamPlans } from "./plan";
import { attendanceMonth, callReport, holidayList, leadQueue, mapToday, mrMe, teamPeople, teamToday } from "./team";
import {
  addVisitFile,
  addVisits,
  checkIn,
  closeCall,
  judgeCall,
  moveVisit,
  pinFromVisit,
  readVisitFile,
  reopenCall,
  saveDraft,
  setVisitPlan,
  skipVisit,
  visitList,
  visitPage,
} from "./visits";
import { FOLLOW_UP_KINDS, MEETINGS, MISS_REASONS, NATURES, OUTCOMES, PRODUCTIVES, WORK_TYPES } from "./words";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day.");
const month = z.string().regex(/^\d{4}-\d{2}$/, "Pick the month.");
const text = (max: number) => z.string().max(max).nullish();
const ids = z.array(z.number().int().positive()).max(40).nullish();
const workType = z.enum(WORK_TYPES as [string, ...string[]], { message: "Pick where you work today." });
const pesos = (value: unknown) => {
  const number = Number(String(value ?? "").replace(/[₱,\s]/g, ""));
  return Number.isFinite(number) ? Math.round(number * 100) : Number.NaN;
};

/** A form with an optional file (a photo or a PDF) and its text fields. */
async function formWithFile(c: Context<Env>, max: number): Promise<{ fields: Record<string, string>; file: IncomingFile | null }> {
  const length = Number(c.req.header("content-length") ?? 0);
  if (length > max + 256 * 1024) throw new Refusal(400, "invalid", "That file is over 10 MB. Take the photo again.", "file");
  const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) if (typeof value === "string") fields[key] = value.trim();
  const raw = body.file;
  const file =
    raw instanceof File && raw.size > 0 ? { name: raw.name, mime: raw.type, bytes: new Uint8Array(await raw.arrayBuffer()) } : null;
  return { fields, file };
}

const fileReply = (c: Context<Env>, file: { name: string; mime: string; bytes: Uint8Array }) =>
  c.body(file.bytes as Uint8Array<ArrayBuffer>, 200, {
    "content-type": file.mime,
    "content-disposition": `inline; filename="${encodeURIComponent(file.name)}"`,
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-cache",
  });

const profileInput = z.object({
  category: text(1),
  dispensing: z.boolean().nullish(),
  qualification: text(120),
  gender: z.enum(["male", "female", "other"]).nullish(),
  hospitalType: z.enum(["government", "private"]).nullish(),
  hospitalClass: z.enum(["general", "specialty"]).nullish(),
  firmType: z.enum(["super_stockist", "distributor", "sub_distributor", "stockist", "retailer"]).nullish(),
  contactPerson: text(120),
  zone: text(80),
  prefDays: z.array(z.string().max(3)).max(7).nullish(),
  prefTime: text(60),
  firmId: z.number().int().positive().nullish(),
  visitsAMonth: z.number().int().min(0).max(31).nullish(),
});

const product = z.object({
  medicineId: z.number().int().positive(),
  promoted: z.boolean(),
  reaction: z.enum(["will_prescribe", "prescribes", "needs_info", "not_interested"]).nullish(),
  prescribing: z.boolean().nullish(),
  competitor: text(120),
  inStock: z.boolean().nullish(),
  stock: z.number().int().min(0).nullish(),
  sold: z.number().int().min(0).nullish(),
  demand: z.enum(["high", "normal", "low"]).nullish(),
});

export function mrRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>) {
  app.use("/api/mr/*", signedIn);

  // How the field stands for this person, the MR's day.
  app.get("/api/mr/me", async (c) => c.json(await mrMe(db, c.get("me"))));
  app.get("/api/mr/home", async (c) => c.json(await mrHome(db, c.get("me"))));
  const placeInput = z.object({
    workType,
    workNote: text(200),
    cities: z.array(z.string().max(80)).max(12),
    workingWith: ids,
    place: text(60),
    accuracy: z.number().nonnegative().nullish(),
  });
  app.post("/api/mr/day/start", async (c) => {
    const input = await readBody(c, placeInput);
    await startWorking(db, c.get("me"), input as Parameters<typeof startWorking>[2]);
    return c.json({ ok: true });
  });
  app.post("/api/mr/day/place", async (c) => {
    const input = await readBody(c, placeInput);
    await changePlace(db, c.get("me"), input as Parameters<typeof changePlace>[2]);
    return c.json({ ok: true });
  });
  app.post("/api/mr/day/break", async (c) => {
    const input = await readBody(c, z.object({ on: z.boolean(), place: text(60) }));
    await takeBreak(db, c.get("me"), input);
    return c.json({ ok: true });
  });
  app.get("/api/mr/day/report", async (c) =>
    c.json(await dayReport(db, c.get("me"), { day: c.req.query("day"), person: Number(c.req.query("person")) || null })),
  );
  app.post("/api/mr/day/report", async (c) => {
    const input = await readBody(
      c,
      z.object({
        missed: z
          .array(
            z.object({
              visitId: z.number().int().positive(),
              reason: z.enum(MISS_REASONS as [string, ...string[]], { message: "Pick why each visit didn't happen." }),
              note: text(300),
            }),
          )
          .max(200),
        note: text(1000),
        place: text(60),
      }),
    );
    await sendDayReport(db, c.get("me"), input as Parameters<typeof sendDayReport>[2]);
    return c.json({ ok: true });
  });
  app.post("/api/mr/day/report/seen", async (c) => {
    const input = await readBody(c, z.object({ person: z.number().int().positive(), day, note: text(300) }));
    await seeDayReport(db, c.get("me"), input);
    return c.json({ ok: true });
  });

  // Visits and calls.
  app.get("/api/mr/visits", async (c) =>
    c.json(
      await visitList(db, c.get("me"), {
        kind: c.req.query("kind"),
        day: c.req.query("day"),
        month: c.req.query("month"),
        person: c.req.query("person"),
      }),
    ),
  );
  app.post("/api/mr/visits", async (c) => {
    const input = await readBody(
      c,
      z.object({
        day,
        customerIds: z.array(z.number().int().positive()).min(1, "Pick whom to visit.").max(40),
        objectives: z.array(z.string().max(40)).max(6).nullish(),
        why: text(300),
      }),
    );
    return c.json(await addVisits(db, c.get("me"), input));
  });
  app.get("/api/mr/visits/:id", async (c) => c.json(await visitPage(db, c.get("me"), idParam(c))));
  app.post("/api/mr/visits/:id/plan", async (c) => {
    const input = await readBody(
      c,
      z.object({
        objectives: z.array(z.string().max(40)).max(6),
        objectiveNote: text(300),
        priority: z.number().int().min(1).max(3).nullish(),
        workingWith: ids,
      }),
    );
    await setVisitPlan(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.post("/api/mr/visits/:id/draft", async (c) => {
    const input = await readBody(c, z.object({ draft: z.record(z.string(), z.unknown()) }));
    await saveDraft(db, c.get("me"), idParam(c), input.draft);
    return c.json({ ok: true });
  });
  app.post("/api/mr/visits/:id/check-in", async (c) => {
    const input = await readBody(c, z.object({ place: text(60) }));
    await checkIn(db, c.get("me"), idParam(c), input.place);
    return c.json({ ok: true });
  });
  app.post("/api/mr/visits/:id/close", async (c) => {
    const input = await readBody(
      c,
      z.object({
        meeting: z.enum(MEETINGS as [string, ...string[]], { message: "Say whether you met them." }),
        objectives: z.array(z.string().max(40)).max(6),
        objectiveNote: text(300),
        products: z.array(product).max(60),
        prescribing: z.array(z.object({ medicineId: z.number().int().positive(), prescribing: z.boolean(), top5: z.boolean() })).max(80).nullish(),
        call: z
          .object({
            met: z.array(z.string().max(80)).max(20).nullish(),
            pharmacy: text(500),
            purchasing: text(500),
            institutional: text(500),
            chemist: text(300),
            money: text(300),
            market: text(500),
            competitors: text(500),
          })
          .nullish(),
        nature: z.enum(NATURES as [string, ...string[]]).nullish(),
        outcome: z.enum(OUTCOMES as [string, ...string[]], { message: "Say what came of the call." }),
        productive: z.enum(PRODUCTIVES as [string, ...string[]], { message: "Say whether the call was productive." }),
        feedback: text(1000),
        notes: text(1000),
        chanceAmount: z.number().int().positive().nullish(),
        chanceOn: day.nullish(),
        followUp: z.object({ on: day, kind: z.enum(FOLLOW_UP_KINDS as [string, ...string[]]), what: z.string().max(300) }).nullish(),
        nextDay: day.nullish(),
        place: text(60),
      }),
    );
    return c.json(await closeCall(db, c.get("me"), idParam(c), input as Parameters<typeof closeCall>[3]));
  });
  app.post("/api/mr/visits/:id/skip", async (c) => {
    const input = await readBody(
      c,
      z.object({ reason: z.enum(MISS_REASONS as [string, ...string[]], { message: "Pick why it didn't happen." }), note: text(300) }),
    );
    await skipVisit(db, c.get("me"), idParam(c), input as Parameters<typeof skipVisit>[3]);
    return c.json({ ok: true });
  });
  app.post("/api/mr/visits/:id/move", async (c) => {
    const input = await readBody(c, z.object({ day, why: text(300) }));
    await moveVisit(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.post("/api/mr/visits/:id/reopen", async (c) => {
    const input = await readBody(c, z.object({ note: z.string().max(300) }));
    await reopenCall(db, c.get("me"), idParam(c), input.note);
    return c.json({ ok: true });
  });
  app.post("/api/mr/visits/:id/judge", async (c) => {
    const input = await readBody(c, z.object({ productive: z.enum(["yes", "no"]), note: text(300) }));
    await judgeCall(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.post("/api/mr/visits/:id/pin", async (c) => {
    await pinFromVisit(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });
  app.post("/api/mr/visits/:id/files", async (c) => {
    const { file } = await formWithFile(c, 10 * 1024 * 1024);
    if (!file) throw new Refusal(400, "invalid", "Attach a photo.", "file");
    return c.json(await addVisitFile(db, c.get("me"), idParam(c), file));
  });
  app.get("/api/mr/visits/:id/files/:file", async (c) =>
    fileReply(c, await readVisitFile(db, c.get("me"), idParam(c), Number(c.req.param("file")) || 0)),
  );

  // Customers' field pages (KOLs, hospitals, KBLs).
  app.get("/api/mr/clients", async (c) =>
    c.json(await clientList(db, c.get("me"), { kind: c.req.query("kind"), scope: c.req.query("scope"), q: c.req.query("q") })),
  );
  app.get("/api/mr/clients/pick", async (c) =>
    c.json(await clientsIn(db, c.get("me"), { kind: c.req.query("kind"), cities: c.req.query("cities"), q: c.req.query("q") })),
  );
  app.get("/api/mr/cities", async (c) => c.json({ cities: await fieldCities(db, c.get("me")) }));
  app.get("/api/mr/clients/off-requests", async (c) => c.json({ rows: await offRequests(db, c.get("me")) }));
  app.get("/api/mr/clients/:id", async (c) => c.json(await clientPage(db, c.get("me"), idParam(c))));
  app.get("/api/mr/clients/:id/calls", async (c) => c.json({ rows: await callHistory(db, c.get("me"), idParam(c)) }));
  app.post("/api/mr/clients/:id/profile", async (c) => {
    const input = await readBody(c, profileInput);
    await saveProfile(db, c.get("me"), idParam(c), input as Parameters<typeof saveProfile>[3]);
    return c.json({ ok: true });
  });
  app.post("/api/mr/clients/:id/ask-off", async (c) => {
    const input = await readBody(c, z.object({ why: z.string().max(300) }));
    await askOffList(db, c.get("me"), idParam(c), input.why);
    return c.json({ ok: true });
  });
  app.post("/api/mr/clients/:id/answer-off", async (c) => {
    const input = await readBody(c, z.object({ remove: z.boolean() }));
    await answerOffList(db, c.get("me"), idParam(c), input.remove);
    return c.json({ ok: true });
  });

  // Follow-ups.
  app.get("/api/mr/follow-ups", async (c) =>
    c.json({ rows: await followUpList(db, c.get("me"), { status: c.req.query("status"), person: c.req.query("person") }) }),
  );
  app.post("/api/mr/follow-ups", async (c) => {
    const input = await readBody(
      c,
      z.object({
        customerId: z.number().int().positive(),
        dueOn: day,
        kind: z.enum(FOLLOW_UP_KINDS as [string, ...string[]]),
        what: z.string().max(300),
      }),
    );
    return c.json(await addFollowUp(db, c.get("me"), input as Parameters<typeof addFollowUp>[2]));
  });
  app.post("/api/mr/follow-ups/:id", async (c) => {
    const input = await readBody(c, z.object({ drop: z.boolean().nullish(), note: text(300) }));
    await closeFollowUp(db, c.get("me"), idParam(c), { drop: Boolean(input.drop), note: input.note });
    return c.json({ ok: true });
  });

  // Tour plan.
  app.get("/api/mr/plan", async (c) =>
    c.json(await planMonth(db, c.get("me"), { month: c.req.query("month"), person: Number(c.req.query("person")) || null })),
  );
  app.get("/api/mr/plan/team", async (c) => c.json(await teamPlans(db, c.get("me"), c.req.query("month"))));
  app.post("/api/mr/plan/day", async (c) => {
    const input = await readBody(
      c,
      z.object({ day, workType, cities: z.array(z.string().max(80)).max(12), workingWith: ids, note: text(300), why: text(300) }),
    );
    await setPlanDay(db, c.get("me"), input as Parameters<typeof setPlanDay>[2]);
    return c.json({ ok: true });
  });
  app.post("/api/mr/plan/send", async (c) => {
    const input = await readBody(c, z.object({ month }));
    await sendPlan(db, c.get("me"), input.month);
    return c.json({ ok: true });
  });
  app.post("/api/mr/plan/decide", async (c) => {
    const input = await readBody(c, z.object({ person: z.number().int().positive(), month, approve: z.boolean(), note: text(300) }));
    await decidePlan(db, c.get("me"), input);
    return c.json({ ok: true });
  });
  app.get("/api/mr/deviations", async (c) => c.json({ rows: await deviationList(db, c.get("me"), { status: c.req.query("status") }) }));
  app.post("/api/mr/deviations/:id", async (c) => {
    const input = await readBody(c, z.object({ approve: z.boolean(), note: text(300) }));
    await decideDeviation(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });

  // Expenses.
  app.get("/api/mr/expenses", async (c) =>
    c.json(
      await expenseMonth(db, c.get("me"), {
        month: c.req.query("month"),
        person: c.req.query("person"),
        waiting: c.req.query("waiting") === "1",
      }),
    ),
  );
  app.post("/api/mr/expenses", async (c) => {
    const { fields, file } = await formWithFile(c, EXPENSE_FILE_MAX);
    return c.json(
      await addExpense(db, c.get("me"), { day: fields.day ?? "", head: fields.head ?? "", amount: pesos(fields.amount), note: fields.note || null }, file),
    );
  });
  app.post("/api/mr/expenses/:id/claim", async (c) => {
    const { fields, file } = await formWithFile(c, EXPENSE_FILE_MAX);
    await claimExpense(db, c.get("me"), idParam(c), { amount: pesos(fields.amount ?? "0"), note: fields.note || null }, file);
    return c.json({ ok: true });
  });
  app.post("/api/mr/expenses/:id/decide", async (c) => {
    const input = await readBody(c, z.object({ approve: z.boolean(), amount: z.number().nonnegative().nullish(), note: text(300) }));
    await decideExpense(db, c.get("me"), idParam(c), {
      approve: input.approve,
      amount: input.amount === null || input.amount === undefined ? null : Math.round(input.amount * 100),
      note: input.note,
    });
    return c.json({ ok: true });
  });
  app.post("/api/mr/expenses/rates", async (c) => {
    const input = await readBody(
      c,
      z.object({ rates: z.array(z.object({ workType, perDiem: z.number().nonnegative(), ta: z.number().nonnegative() })).max(5) }),
    );
    await setRates(
      db,
      c.get("me"),
      input.rates.map((one) => ({
        workType: one.workType as Parameters<typeof setRates>[2][number]["workType"],
        perDiem: Math.round(one.perDiem * 100),
        ta: Math.round(one.ta * 100),
      })),
    );
    return c.json({ ok: true });
  });
  app.get("/api/mr/expenses/:id/file", async (c) => fileReply(c, await expenseFile(db, c.get("me"), idParam(c))));

  // The team lead's side.
  app.get("/api/mr/team", async (c) => c.json(await teamToday(db, c.get("me"), { day: c.req.query("day") })));
  app.get("/api/mr/team/queue", async (c) => c.json(await leadQueue(db, c.get("me"))));
  app.get("/api/mr/team/people", async (c) => c.json({ people: await teamPeople(db, c.get("me")) }));
  app.get("/api/mr/reports/calls", async (c) =>
    c.json(
      await callReport(db, c.get("me"), {
        from: c.req.query("from"),
        to: c.req.query("to"),
        person: c.req.query("person"),
        status: c.req.query("status"),
        kind: c.req.query("kind"),
      }),
    ),
  );
  app.get("/api/mr/reports/attendance", async (c) =>
    c.json(await attendanceMonth(db, c.get("me"), { month: c.req.query("month"), person: c.req.query("person") })),
  );
  app.get("/api/mr/holidays", async (c) => c.json({ rows: await holidayList(db, c.get("me"), c.req.query("year")) }));
  app.get("/api/mr/map", async (c) => c.json(await mapToday(db, c.get("me"), Number(c.req.query("person")) || null)));
}
