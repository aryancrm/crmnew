// Government tenders and the company's eligibility papers.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, idParam, readBody } from "../http";
import { foundCount, foundDetail, listFound, makeTender, noteRun, robotKey, robotKnown, robotMolecules, screenFound, takeFound } from "./finder";
import {
  addCompanyPaper,
  bidReport,
  companyPapers,
  createTender,
  listTenders,
  moveTender,
  removeBidder,
  saveBidder,
  saveTender,
  setLines,
  STEPS,
  tenderDesk,
  tenderDetail,
} from "./service";

const REASONS = ["lowest", "lower_price", "above_abc", "documents", "post_disqualified", "failed_bidding", "other"] as const;
const BIDDER = z.object({
  name: z.string().trim().min(2, "Name the bidder.").max(160),
  price: z.number().int().min(0).max(1_000_000_000_000).nullish(),
  lines: z.array(z.object({ medicineId: z.number().int().positive(), unitPrice: z.number().int().min(0) })).max(200).optional(),
  disqualified: z.boolean().optional(),
  note: z.string().max(500).nullish(),
});

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day.");
const MONEY = z.number().int().min(0).max(1_000_000_000_000);
const MODES = ["competitive_bidding", "limited_source", "direct_contracting", "direct_acquisition", "repeat_order", "small_value", "negotiated", "direct_sales", "other"] as const;

export function tenderRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  for (const path of ["/api/tenders", "/api/tenders/*", "/api/company-papers"]) app.use(path, signedIn);
  app.get("/api/tenders", async (c) => c.json(await listTenders(db, c.get("me"))));
  app.get("/api/tenders/desk", async (c) => c.json(await tenderDesk(db, c.get("me"))));
  // The bid report: every price read, won or lost and why, by agency, securities, what is coming.
  app.get("/api/tenders/report", async (c) =>
    c.json(await bidReport(db, c.get("me"), { from: c.req.query("from"), to: c.req.query("to") })),
  );
  // The other bids read at the opening (the abstract of bids), written on the tender.
  app.post("/api/tenders/:id/bidders", async (c) => {
    const input = await readBody(c, BIDDER);
    return c.json(await saveBidder(db, c.get("me"), Number(c.req.param("id")), input));
  });
  app.post("/api/tenders/:id/bidders/:bidder", async (c) => {
    const input = await readBody(c, BIDDER);
    return c.json(await saveBidder(db, c.get("me"), Number(c.req.param("id")), input, Number(c.req.param("bidder"))));
  });
  app.post("/api/tenders/bidders/:bidder/remove", async (c) => {
    await removeBidder(db, c.get("me"), Number(c.req.param("bidder")));
    return c.json({ ok: true });
  });
  // The tender finder (docs/PLAN.md 24): what the robot found, the team's screened list, and the
  // join that makes a found notice a tender. Before "/api/tenders/:id", which would read "found"
  // as a tender's number.
  app.get("/api/tenders/found", async (c) =>
    c.json(await listFound(db, c.get("me"), { view: c.req.query("view"), q: c.req.query("q"), source: c.req.query("source"), molecule: c.req.query("molecule") })),
  );
  app.get("/api/tenders/found/count", async (c) => c.json(await foundCount(db, c.get("me"))));
  app.get("/api/tenders/found/:id", async (c) => c.json(await foundDetail(db, c.get("me"), idParam(c))));
  app.post("/api/tenders/found/:id/screen", async (c) => {
    const input = await readBody(c, z.object({ on: z.boolean() }));
    await screenFound(db, c.get("me"), idParam(c), input.on);
    return c.json({ ok: true });
  });
  app.post("/api/tenders/found/:id/tender", async (c) => {
    const input = await readBody(
      c,
      z.object({
        agencyId: z.number().int().positive(),
        mode: z.enum(MODES),
        title: z.string().trim().min(3, "Type what the tender buys.").max(300).nullish(),
        lines: z
          .array(
            z.object({
              lineId: z.number().int().positive(),
              medicineId: z.number().int().positive(),
              qty: z.number().int("Pieces are whole numbers.").positive("Type how many pieces.").max(100_000_000),
              unitPrice: z.number().int().min(0).max(2_000_000_000),
            }),
          )
          .max(400),
      }),
    );
    return c.json(await makeTender(db, c.get("me"), idParam(c), input));
  });
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
        performanceSecurityForm: z.string().max(60).nullish(),
        performanceSecurityAmount: MONEY.nullish(),
        performanceSecurityBackOn: DAY.nullish(),
        retentionAmount: MONEY.nullish(),
        retentionBackOn: DAY.nullish(),
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
      z.object({
        step: z.enum(STEPS as [string, ...string[]]),
        note: z.string().max(500).nullish(),
        on: DAY.nullish(),
        winningBid: MONEY.nullish(),
        reason: z.enum(REASONS).nullish(),
      }),
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

/** The robot's own door (docs/PLAN.md 24): the tender finder's worker is no person, so it has no
 *  sign-in; it shows its key (TENDER_FINDER_KEY) on every call. It may ask which molecules are
 *  ours and which notices are already read, and hand in what it found and how its run went.
 *  Nothing else of the CRM opens with that key. */
export function tenderFinderDoor(app: Hono<Env>, db: Database): void {
  app.use("/webhooks/tender-finder/*", async (c, next) => {
    const key = robotKey(c.req.header("authorization"));
    if (key === "off") return c.json({ error: { code: "not_set_up", message: "The tender finder's key is not set on this server." } }, 503);
    if (key === "no") return c.json({ error: { code: "not_allowed", message: "Wrong key." } }, 401);
    await next();
  });
  const SOURCE = z.enum(["philgeps", "ps"]);
  app.get("/webhooks/tender-finder/molecules", async (c) => c.json(await robotMolecules(db)));
  app.post("/webhooks/tender-finder/known", async (c) => {
    const input = await readBody(c, z.object({ source: SOURCE.default("philgeps"), refs: z.array(z.string().min(1).max(60)).max(1000) }));
    return c.json(await robotKnown(db, input.source, input.refs));
  });
  app.post("/webhooks/tender-finder/notices", async (c) => {
    const input = await readBody(
      c,
      z.object({
        notices: z
          .array(
            z.object({
              source: SOURCE.optional(),
              ref_no: z.string().trim().min(1).max(60),
              title: z.string().max(4000),
              procuring_entity: z.string().max(1000).nullish(),
              publish_date: z.string().max(40).nullish(),
              closing_date: z.string().max(40).nullish(),
              abc_amount: z.number().nullish(),
              detail_link: z.string().max(1000).nullish(),
              items_text: z.string().max(400_000).nullish(),
              details: z.record(z.string(), z.unknown()).nullish(),
            }),
          )
          .min(1)
          .max(50),
      }),
    );
    return c.json(await takeFound(db, input.notices));
  });
  app.post("/webhooks/tender-finder/run", async (c) => {
    const input = await readBody(
      c,
      z.object({
        source: SOURCE.optional(),
        trigger: z.string().max(40).nullish(),
        status: z.enum(["success", "failed"]),
        summary: z.string().max(2000).nullish(),
        found: z.number().int().min(0).optional(),
        matched: z.number().int().min(0).optional(),
        fresh: z.number().int().min(0).optional(),
      }),
    );
    await noteRun(db, input);
    return c.json({ ok: true });
  });
}
