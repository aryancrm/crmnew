// Government tenders and the company's eligibility papers.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, readBody } from "../http";
import { addCompanyPaper, companyPapers, createTender, listTenders, moveTender, saveTender, setLines, STEPS, tenderDesk, tenderDetail } from "./service";

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day.");
const MONEY = z.number().int().min(0).max(1_000_000_000_000);
const MODES = ["competitive_bidding", "limited_source", "direct_contracting", "direct_acquisition", "repeat_order", "small_value", "negotiated", "direct_sales", "other"] as const;

export function tenderRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  for (const path of ["/api/tenders", "/api/tenders/*", "/api/company-papers"]) app.use(path, signedIn);
  app.get("/api/tenders", async (c) => c.json(await listTenders(db, c.get("me"))));
  app.get("/api/tenders/desk", async (c) => c.json(await tenderDesk(db, c.get("me"))));
  app.get("/api/tenders/:id", async (c) => c.json(await tenderDetail(db, c.get("me"), Number(c.req.param("id")))));
  app.post("/api/tenders", async (c) => {
    const input = await readBody(
      c,
      z.object({
        agencyId: z.number().int().positive(),
        title: z.string().trim().min(3, "Type what the tender buys."),
        philgepsRef: z.string().max(60).nullish(),
        mode: z.enum(MODES),
        abc: MONEY.nullish(),
        postedOn: DAY.nullish(),
        prebidOn: DAY.nullish(),
        deadlineAt: z.string().nullish(),
        openingOn: DAY.nullish(),
      }),
    );
    return c.json(await createTender(db, c.get("me"), input));
  });
  app.post("/api/tenders/:id", async (c) => {
    const input = await readBody(
      c,
      z.object({
        philgepsRef: z.string().max(60).nullish(),
        abc: MONEY.nullish(),
        prebidOn: DAY.nullish(),
        deadlineAt: z.string().nullish(),
        openingOn: DAY.nullish(),
        bidSecurityForm: z.string().max(60).nullish(),
        bidSecurityAmount: MONEY.nullish(),
        bidSecurityBackOn: DAY.nullish(),
        deliverBy: DAY.nullish(),
        papers: z.array(z.object({ paper: z.string(), done: z.boolean() })).nullish(),
      }),
    );
    await saveTender(db, c.get("me"), Number(c.req.param("id")), {
      ...input,
      papers: input.papers ?? undefined,
    } as Parameters<typeof saveTender>[3]);
    return c.json({ ok: true });
  });
  app.post("/api/tenders/:id/lines", async (c) => {
    const input = await readBody(
      c,
      z.object({ lines: z.array(z.object({ medicineId: z.number().int().positive(), qty: z.number().int().positive(), unitPrice: z.number().int().min(0) })).min(1, "Add the medicines bid.") }),
    );
    await setLines(db, c.get("me"), Number(c.req.param("id")), input.lines);
    return c.json({ ok: true });
  });
  app.post("/api/tenders/:id/step", async (c) => {
    const input = await readBody(
      c,
      z.object({ step: z.enum(STEPS as [string, ...string[]]), note: z.string().max(500).nullish(), on: DAY.nullish(), winningBid: MONEY.nullish() }),
    );
    await moveTender(db, c.get("me"), Number(c.req.param("id")), input as Parameters<typeof moveTender>[3]);
    return c.json({ ok: true });
  });
  app.get("/api/company-papers", async (c) => c.json(await companyPapers(db)));
  app.post("/api/company-papers", async (c) => {
    const input = await readBody(c, z.object({ name: z.string().trim().min(2), number: z.string().max(80).nullish(), expiresOn: DAY.nullish(), note: z.string().max(300).nullish() }));
    await addCompanyPaper(db, c.get("me"), input);
    return c.json({ ok: true });
  });
}
