// Samples and gifts with the reps (ERP phase 3): ask, decide, issue or send, receive, give at a
// visit with the doctor's acknowledgement, count; a rep's own page and the team's.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { bytesOf } from "../files/store";
import { type Env, idParam, Refusal, readBody } from "../http";
import type { SampleKind } from "../types";
import {
  askSamples,
  countSamples,
  decideSamples,
  giveSamples,
  issueSamples,
  receiveSamples,
  sampleAck,
  samplesOf,
  sendSamples,
  teamSamples,
  withdrawSamples,
} from "./service";

const kind = z.enum(["samples", "gifts"], { error: "Samples or gifts?" });
const lines = z.array(z.object({ medicineId: z.number().int().positive(), qty: z.number().int() })).max(50);

export function sampleRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/samples/*", signedIn);
  app.use("/api/samples", signedIn);
  app.get("/api/samples", async (c) =>
    c.json(await samplesOf(db, c.get("me"), { personId: Number(c.req.query("person")) || null, month: c.req.query("month") })),
  );
  app.get("/api/samples/team", async (c) => c.json(await teamSamples(db, c.get("me"), { month: c.req.query("month") })));
  app.post("/api/samples/requests", async (c) => {
    const input = await readBody(c, z.object({ kind, lines, note: z.string().trim().max(300).nullish() }));
    return c.json(await askSamples(db, c.get("me"), input));
  });
  app.post("/api/samples/requests/:id/decide", async (c) => {
    const input = await readBody(c, z.object({ approve: z.boolean(), reason: z.string().trim().max(300).nullish() }));
    await decideSamples(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.post("/api/samples/requests/:id/withdraw", async (c) => {
    await withdrawSamples(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });
  app.post("/api/samples/requests/:id/issue", async (c) => {
    const input = await readBody(c, z.object({ warehouseId: z.number().int().positive().nullish() }));
    await issueSamples(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.post("/api/samples/requests/:id/receive", async (c) => {
    await receiveSamples(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });
  app.post("/api/samples/send", async (c) => {
    const input = await readBody(
      c,
      z.object({ personId: z.number().int().positive(), kind, lines, note: z.string().trim().max(300).nullish(), warehouseId: z.number().int().positive().nullish() }),
    );
    return c.json(await sendSamples(db, c.get("me"), input));
  });
  app.post("/api/samples/count", async (c) => {
    const input = await readBody(
      c,
      z.object({ kind, lines: z.array(z.object({ batchId: z.number().int().positive(), counted: z.number().int(), reason: z.string().trim().max(300).nullish() })) }),
    );
    return c.json(await countSamples(db, c.get("me"), input));
  });
  // Given at a visit, with the doctor's signed acknowledgement (a photo or PDF).
  app.post("/api/samples/give", async (c) => {
    if (Number(c.req.header("content-length") ?? 0) > 11 * 1024 * 1024)
      throw new Refusal(400, "invalid", "That file is over 10 MB. Take the photo again.", "file");
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const file = body.file;
    let parsed: { medicineId: number; qty: number }[] = [];
    try {
      parsed = JSON.parse(String(body.lines ?? "[]"));
    } catch {
      throw new Refusal(400, "invalid", "Add the medicines given.", "lines");
    }
    await giveSamples(db, c.get("me"), {
      visitId: Number(body.visitId),
      kind: String(body.kind) as SampleKind,
      lines: parsed.map((one) => ({ medicineId: Number(one.medicineId), qty: Number(one.qty) })),
      ack: file instanceof File && file.size > 0 ? { name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) } : null,
    });
    return c.json({ ok: true });
  });
  app.get("/api/samples/given/:id/ack", async (c) => {
    const ack = await sampleAck(db, c.get("me"), idParam(c));
    const bytes = await bytesOf(ack);
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      "content-type": ack.mime,
      "content-disposition": `inline; filename="${encodeURIComponent(ack.name)}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=604800, immutable",
    });
  });
}
