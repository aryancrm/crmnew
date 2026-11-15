// The field's addresses: a person's visits on a day, the visit forms' lists, planning, check in,
// the call report, skip and move, the month plan (make, send, approve), a customer's class and
// clinic pin, field expenses with their bills, and the visits report.

import type { Context, Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, idParam, Refusal, readBody } from "../http";
import type { ExpenseInput, ExpenseKind, VisitClass } from "../types";
import {
  addExpense,
  changeExpense,
  decideExpense,
  EXPENSE_KINDS,
  fieldExpenses,
  RECEIPT_MAX_BYTES,
  type Receipt,
  readReceipt,
} from "./expenses";
import { decidePlan, fieldPlan, makePlan, pinClinic, sendPlan, setVisitClass } from "./plan";
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
const month = z.string().regex(/^\d{4}-\d{2}$/, "Pick the month.");

/** An expense sent as a form (its fields as text) with the bill's photo as `file`. */
async function expenseForm(
  c: Context<Env>,
): Promise<{ input: ExpenseInput; receipt: Receipt | null }> {
  const length = Number(c.req.header("content-length") ?? 0);
  if (length > RECEIPT_MAX_BYTES + 64 * 1024)
    throw new Refusal(400, "invalid", "That file is over 10 MB. Take the photo again.", "file");
  const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string).trim() : "");
  const pesos = Number(text("amount").replace(/[₱,\s]/g, ""));
  const kind = text("kind") as ExpenseKind;
  if (!EXPENSE_KINDS.includes(kind))
    throw new Refusal(400, "invalid", "Say what it was for.", "kind");
  const file = body.file;
  return {
    input: {
      day: text("day"),
      kind,
      amount: Number.isFinite(pesos) ? Math.round(pesos * 100) : 0,
      km: text("km") ? Number(text("km")) : null,
      visitId: text("visitId") ? Number(text("visitId")) : null,
      note: text("note") || null,
    },
    receipt:
      file instanceof File && file.size > 0
        ? { name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }
        : null,
  };
}
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

  app.post("/api/field/visits/:id/pin", async (c) => {
    await pinClinic(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });
  app.get("/api/field/plan", async (c) =>
    c.json(
      await fieldPlan(db, c.get("me"), {
        month: c.req.query("month"),
        person: Number(c.req.query("person")) || null,
      }),
    ),
  );
  app.post("/api/field/plan/make", async (c) => {
    const input = await readBody(c, z.object({ month }));
    return c.json(await makePlan(db, c.get("me"), input.month));
  });
  app.post("/api/field/plan/send", async (c) => {
    const input = await readBody(c, z.object({ month }));
    await sendPlan(db, c.get("me"), input.month);
    return c.json({ ok: true });
  });
  app.post("/api/field/plan/:id/decide", async (c) => {
    const input = await readBody(c, z.object({ month, approve: z.boolean(), note: words(300) }));
    await decidePlan(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.post("/api/field/customers/:id/class", async (c) => {
    const input = await readBody(
      c,
      z.object({ visitClass: z.enum(["A", "B", "C", "D"]).nullable() }),
    );
    await setVisitClass(db, c.get("me"), idParam(c), input.visitClass as VisitClass | null);
    return c.json({ ok: true });
  });
  app.get("/api/field/expenses", async (c) =>
    c.json(
      await fieldExpenses(db, c.get("me"), {
        from: c.req.query("from"),
        to: c.req.query("to"),
        person: Number(c.req.query("person")) || null,
        waiting: c.req.query("waiting") === "1",
      }),
    ),
  );
  app.post("/api/field/expenses", async (c) => {
    const { input, receipt } = await expenseForm(c);
    return c.json(await addExpense(db, c.get("me"), input, receipt));
  });
  app.post("/api/field/expenses/:id", async (c) => {
    const { input, receipt } = await expenseForm(c);
    await changeExpense(db, c.get("me"), idParam(c), input, receipt);
    return c.json({ ok: true });
  });
  app.post("/api/field/expenses/:id/decide", async (c) => {
    const input = await readBody(c, z.object({ approve: z.boolean(), note: words(300) }));
    await decideExpense(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.get("/api/field/expenses/:id/receipt", async (c) => {
    const receipt = await readReceipt(db, c.get("me"), idParam(c));
    return c.body(receipt.bytes as Uint8Array<ArrayBuffer>, 200, {
      "content-type": receipt.mime,
      "content-disposition": `inline; filename="${encodeURIComponent(receipt.name)}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=3600",
    });
  });
}
