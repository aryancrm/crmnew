// The Online desk's addresses. The service checks who may do what.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, idParam, Refusal, readBody } from "../http";
import type { GlInput, LeadInput, QuoteInput } from "../types";
import { openQuotationLink, quotationLink, quotationPdf, sendQuotation } from "./quotation";
import { SOURCES } from "./rules";
import {
  addLead,
  handToPap,
  addLeadFile,
  addLeadNote,
  caseRefill,
  closeLead,
  findBuyers,
  LEAD_FILE_MAX_BYTES,
  leadCase,
  leadDesk,
  orderFromLead,
  quoteSent,
  readLeadFile,
  removeLeadFile,
  reopenLead,
  saveCanvass,
  saveClaim,
  saveGl,
  saveLead,
  saveQuote,
  setBuyer,
  setCasePoints,
} from "./service";
import { tellCustomer } from "./tell";

const optional = (max: number) =>
  z.string().trim().max(max, `Keep it under ${max} characters.`).nullish();
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day.")
  .nullish()
  .or(z.literal("").transform(() => null));

const leadInput = z.object({
  source: z.enum(SOURCES as [string, ...string[]], { error: "Say where it came from." }),
  name: z.string({ error: "Type who is asking." }).trim().min(1, "Type who is asking.").max(120),
  relation: optional(40),
  patientName: optional(120),
  phone: optional(40),
  email: z
    .string()
    .trim()
    .max(120)
    .email("Type an email like name@example.com.")
    .nullish()
    .or(z.literal("").transform(() => null)),
  city: optional(80),
  address: optional(300),
  road: z.enum(["regular", "senior", "pwd", "gl"]).optional(),
  agency: z.enum(["dswd", "pcso", "ovp", "op"]).nullish(),
  request: optional(1000),
  assignedTo: z.number().int().positive().nullish(),
});

export function onlineRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  for (const path of ["/api/leads/*", "/api/lead-files/*"]) app.use(path, signedIn);

  app.get("/api/leads", async (c) => {
    const query = c.req.query();
    return c.json(
      await leadDesk(db, c.get("me"), {
        queue: query.queue,
        step: query.step,
        q: query.q,
        source: query.source,
        road: query.road,
        who: query.who,
        type: query.type,
        month: query.month,
        shown: Number(query.shown) || 0,
        desk: query.desk,
      }),
    );
  });
  app.post("/api/leads", async (c) =>
    c.json({ id: await addLead(db, c.get("me"), (await readBody(c, leadInput)) as LeadInput) }),
  );
  // A seller hands their patient to PAP: a guarantee letter is PAP's to work (22 Nov).
  app.post("/api/leads/hand-to-pap", async (c) => {
    const input = await readBody(
      c,
      z.object({
        name: z.string().trim().min(1, "Type the patient's name.").max(160),
        patientName: z.string().max(160).nullish(),
        phone: z.string().max(40).nullish(),
        agency: z.enum(["dswd", "pcso", "ovp", "op"]),
        request: z.string().max(2000).nullish(),
        city: z.string().max(120).nullish(),
        address: z.string().max(400).nullish(),
      }),
    );
    return c.json({ id: await handToPap(db, c.get("me"), input) });
  });
  app.get("/api/leads/:id", async (c) => c.json(await leadCase(db, c.get("me"), idParam(c))));
  app.post("/api/leads/:id", async (c) => {
    await saveLead(db, c.get("me"), idParam(c), (await readBody(c, leadInput)) as LeadInput);
    return c.json({ ok: true });
  });
  app.post("/api/leads/:id/quote", async (c) => {
    const input = await readBody(
      c,
      z.object({
        lines: z
          .array(
            z.object({
              medicineId: z.number({ error: "Pick a medicine." }).int().positive(),
              qty: z
                .number({ error: "Type how many." })
                .int("Use a whole number.")
                .positive("Type how many.")
                .max(1_000_000),
              unitPrice: z.number().int().min(0).max(1_000_000_00).nullish(),
              reason: optional(300),
            }),
          )
          .min(1, "Add at least one medicine.")
          .max(40),
      }),
    );
    await saveQuote(db, c.get("me"), idParam(c), input as QuoteInput);
    return c.json({ ok: true });
  });
  app.post("/api/leads/:id/quote-sent", async (c) => {
    const input = await readBody(c, z.object({ via: z.string().max(20) }));
    await quoteSent(db, c.get("me"), idParam(c), input.via);
    return c.json({ ok: true });
  });
  app.post("/api/leads/:id/gl", async (c) => {
    const input = await readBody(
      c,
      z.object({
        appliedOn: day,
        letterNo: optional(60),
        amount: z.number().int().min(0).max(100_000_000_00).nullish(),
        letterOn: day,
        expiresOn: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day.")
          .nullish()
          .or(z.literal("").transform(() => null)),
        verify: z.boolean().optional(),
      }),
    );
    await saveGl(db, c.get("me"), idParam(c), input as GlInput);
    return c.json({ ok: true });
  });
  app.post("/api/leads/:id/claim", async (c) => {
    const input = await readBody(c, z.object({ sentOn: day, ref: optional(80) }));
    await saveClaim(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.post("/api/leads/:id/canvass", async (c) => {
    const input = await readBody(
      c,
      z.object({
        lines: z
          .array(
            z.object({
              vendor: z.string().max(120),
              amount: z.number().int().min(0).max(100_000_000_00),
            }),
          )
          .max(2, "Two other vendors at most."),
      }),
    );
    await saveCanvass(db, c.get("me"), idParam(c), input.lines);
    return c.json({ ok: true });
  });
  // Who buys: the patient, or a business through the desk (its own price list).
  app.post("/api/leads/:id/buyer", async (c) => {
    const input = await readBody(
      c,
      z.object({
        kind: z.enum(["patient", "hospital", "doctor", "drugstore", "distributor", "government"], { error: "Pick who is buying." }),
        customerId: z.number().int().positive().nullish(),
      }),
    );
    await setBuyer(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.get("/api/leads/:id/buyers", async (c) =>
    c.json(await findBuyers(db, c.get("me"), idParam(c), c.req.query("q") ?? "")),
  );
  // The next refill (step 4): the day the patient's medicines run out, kept on the customer.
  app.post("/api/leads/:id/refill", async (c) => {
    const input = await readBody(
      c,
      z.object({
        on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day.").nullable(),
        note: z.string().max(200).nullish(),
      }),
    );
    await caseRefill(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.post("/api/leads/:id/note", async (c) => {
    const input = await readBody(c, z.object({ message: z.string().max(2000) }));
    await addLeadNote(db, c.get("me"), idParam(c), input.message);
    return c.json({ ok: true });
  });
  app.post("/api/leads/:id/lost", async (c) => {
    const input = await readBody(c, z.object({ reason: optional(300) }));
    await closeLead(db, c.get("me"), idParam(c), input.reason ?? null);
    return c.json({ ok: true });
  });
  app.post("/api/leads/:id/reopen", async (c) => {
    await reopenLead(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });
  const pdf = (file: { bytes: Uint8Array; name: string }) =>
    new Response(file.bytes as Uint8Array<ArrayBuffer>, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${encodeURIComponent(file.name)}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  app.get("/api/leads/:id/quotation.pdf", async (c) =>
    pdf(await quotationPdf(db, c.get("me"), idParam(c))),
  );
  app.post("/api/leads/:id/quotation-link", async (c) =>
    c.json(await quotationLink(db, c.get("me"), idParam(c))),
  );
  app.post("/api/leads/:id/quotation-send", async (c) => {
    const input = await readBody(
      c,
      z.object({
        via: z.enum(["messenger", "email"], { error: "Say how to send it." }),
        link: z.string().max(500).nullish(),
      }),
    );
    await sendQuotation(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  // The customer's link: no sign-in.
  app.get("/api/public/quotation/:token", async (c) =>
    pdf(await openQuotationLink(db, c.req.param("token").slice(0, 100))),
  );
  app.post("/api/leads/:id/points", async (c) => {
    const input = await readBody(
      c,
      z.object({
        points: z.number({ error: "Type how many points." }).int("Use whole points.").min(0),
      }),
    );
    await setCasePoints(db, c.get("me"), idParam(c), input.points);
    return c.json({ ok: true });
  });
  app.post("/api/leads/:id/order", async (c) => {
    const input = await readBody(
      c,
      z.object({ pay: z.enum(["cod", "advance", "terms"]).nullish(), toManagement: z.boolean().optional() }),
    );
    const id = await orderFromLead(
      db,
      c.get("me"),
      idParam(c),
      input.pay,
      input.toManagement ?? false,
    );
    void tellCustomer(db, c.get("me"), id, "confirmed");
    return c.json({ id });
  });

  app.post("/api/leads/:id/files", async (c) => {
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > LEAD_FILE_MAX_BYTES + 64 * 1024)
      throw new Refusal(400, "invalid", "That file is over 10 MB. Take the photo again.", "file");
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const file = body.file;
    if (!(file instanceof File))
      throw new Refusal(400, "invalid", "Attach a photo or a PDF.", "file");
    const id = await addLeadFile(db, c.get("me"), idParam(c), {
      kind: String(body.kind ?? ""),
      name: file.name,
      mime: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return c.json({ id });
  });
  app.get("/api/lead-files/:id", async (c) => {
    const file = await readLeadFile(db, c.get("me"), idParam(c));
    return c.body(file.bytes as Uint8Array<ArrayBuffer>, 200, {
      "content-type": file.mime,
      "content-disposition": `inline; filename="${encodeURIComponent(file.name)}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=604800, immutable",
    });
  });
  app.post("/api/lead-files/:id/remove", async (c) => {
    await removeLeadFile(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });
}
