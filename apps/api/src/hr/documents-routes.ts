// HR's documents, imports and reports: their addresses (docs/HR-PLAN.md, "Documents, imports and
// reports", 26 Nov). Signed in by hrRoutes; each service checks who may.

import type { Hono } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, idParam, Refusal, readBody } from "../http";
import {
  acknowledgeDocument,
  DESKS,
  DOC_KINDS,
  documentList,
  documentPage,
  issueDocument,
  myDocuments,
  signClearance,
  voidDocument,
} from "./documents";
import { reportList, reportWorkbook, runReport } from "./reports";
import { IMPORT_FILE_MAX, importKinds, readImport, runImport, sheetFile } from "./sheets";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const words = (max: number) => z.string().max(max).nullish();

export function documentRoutes(app: Hono<Env>, db: Database): void {
  app.get("/api/hr/documents", async (c) =>
    c.json(
      await documentList(db, c.get("me"), {
        person: Number(c.req.query("person")) || null,
        kind: c.req.query("kind"),
        q: c.req.query("q"),
      }),
    ),
  );
  app.get("/api/hr/documents/mine", async (c) => c.json(await myDocuments(db, c.get("me"))));
  app.get("/api/hr/documents/:id", async (c) => c.json(await documentPage(db, c.get("me"), idParam(c))));
  app.post("/api/hr/documents", async (c) => {
    const input = await readBody(
      c,
      z.object({
        kind: z.enum(DOC_KINDS as [string, ...string[]], { message: "Pick the kind of document." }),
        personId: z.number({ error: "Pick the person." }).int().positive("Pick the person."),
        subject: words(200),
        body: words(8000),
        replyBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day.").nullish(),
      }),
    );
    return c.json(await issueDocument(db, c.get("me"), input as Parameters<typeof issueDocument>[2]));
  });
  app.post("/api/hr/documents/:id/void", async (c) => {
    const input = await readBody(c, z.object({ reason: words(300) }));
    await voidDocument(db, c.get("me"), idParam(c), input.reason);
    return c.json({ ok: true });
  });
  app.post("/api/hr/documents/:id/acknowledge", async (c) => {
    const input = await readBody(c, z.object({ reply: words(8000) }));
    await acknowledgeDocument(db, c.get("me"), idParam(c), input.reply);
    return c.json({ ok: true });
  });
  app.post("/api/hr/documents/:id/sign", async (c) => {
    const input = await readBody(
      c,
      z.object({ desk: z.enum(DESKS as [string, ...string[]], { message: "Pick the desk." }), note: words(500) }),
    );
    await signClearance(db, c.get("me"), idParam(c), input as Parameters<typeof signClearance>[3]);
    return c.json({ ok: true });
  });

  // Sheets in and out: the list, a sheet's current data or blank template, and the import's steps.
  app.get("/api/hr/import", (c) => c.json(importKinds(c.get("me"))));
  app.get("/api/hr/export/:file", async (c) => {
    const file = await sheetFile(db, c.get("me"), c.req.param("file").replace(/\.xlsx$/, ""), {
      template: c.req.query("template") === "1",
      year: Number(c.req.query("year")) || null,
    });
    return c.body(new Uint8Array(file.bytes), 200, { "content-type": XLSX, "content-disposition": `attachment; filename="${file.name}"` });
  });
  app.post("/api/hr/import/:kind/read", async (c) => {
    if (Number(c.req.header("content-length") ?? 0) > IMPORT_FILE_MAX + 64 * 1024)
      throw new Refusal(400, "invalid", "That file is over 10 MB.", "file");
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const file = body.file;
    return c.json(
      readImport(
        c.get("me"),
        c.req.param("kind"),
        file instanceof File && file.size > 0 ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : null,
      ),
    );
  });
  app.post("/api/hr/import/:kind", async (c) => {
    const input = await readBody(
      c,
      z.object({
        mapping: z.record(z.string(), z.number().int().min(0).max(500).nullable()),
        rows: z.array(z.array(z.string().max(2000)).max(500)).max(2000),
        save: z.boolean(),
      }),
    );
    return c.json(await runImport(db, c.get("me"), c.req.param("kind"), input));
  });

  // HR's reports: the list, and one report as JSON or (…/key.xlsx) as Excel.
  app.get("/api/hr/reports", (c) => c.json(reportList(c.get("me"))));
  app.get("/api/hr/reports/:key", async (c) => {
    const key = c.req.param("key");
    const excel = key.endsWith(".xlsx");
    const report = await runReport(db, c.get("me"), key.replace(/\.xlsx$/, ""), {
      from: c.req.query("from"),
      to: c.req.query("to"),
      year: c.req.query("year"),
      days: c.req.query("days"),
      company: c.req.query("company"),
    });
    if (!excel) return c.json(report);
    return c.body(new Uint8Array(reportWorkbook(report)), 200, {
      "content-type": XLSX,
      "content-disposition": `attachment; filename="hr-${report.key}-${report.asked.to}.xlsx"`,
    });
  });
}
