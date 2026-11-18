// Sales against target: a team's month, the channels', the CEO Home and the company tree.

import type { Hono, MiddlewareHandler } from "hono";
import { targetSheet } from "./target-sheet";
import type { Database } from "../db/index";
import { z } from "zod";
import { listCalls, logSalesCall } from "../calls/service";
import { allow, type Env, readBody } from "../http";
import { salesPerformance } from "./performance";
import { performanceWorkbook } from "./performance-xlsx";
import { monthFacts } from "./rules";
import { ceoHome, channelSales, channelSalesDetail, companyTree, teamSales } from "./service";

export function salesRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  for (const path of ["/api/team/*", "/api/ceo/*", "/api/company/*", "/api/channel-sales/*", "/api/calls", "/api/calls/*", "/api/sales-performance", "/api/sales-performance/*", "/api/target-sheet"])
    app.use(path, signedIn);

  // Sales calls and the daily sales performance (the B2B team's end-of-day report).
  const asked = (c: { req: { query: (name: string) => string | undefined } }) => ({
    from: c.req.query("from"),
    to: c.req.query("to"),
    lead: Number(c.req.query("lead")) || null,
    person: Number(c.req.query("person")) || null,
    channel: c.req.query("channel") || null,
  });
  app.post("/api/calls", async (c) =>
    c.json(
      await logSalesCall(
        db,
        c.get("me"),
        await readBody(
          c,
          z.object({
            customerId: z.number().int().positive().nullish(),
            customerName: z.string().max(200).nullish(),
            outcome: z.enum(["reached", "no_answer", "call_back", "ordered", "not_interested", "won_back"], { error: "Pick what came of the call." }),
            note: z.string().max(2000).nullish(),
            nextOn: z.string().nullish(),
          }),
        ),
      ),
    ),
  );
  app.get("/api/calls", async (c) => c.json(await listCalls(db, c.get("me"), asked(c))));
  app.get("/api/target-sheet", async (c) =>
    c.json(await targetSheet(db, c.get("me"), { month: c.req.query("month"), day: c.req.query("day") })),
  );
  app.get("/api/sales-performance", async (c) => c.json(await salesPerformance(db, c.get("me"), asked(c))));
  app.get("/api/sales-performance/xlsx", async (c) => {
    const report = await salesPerformance(db, c.get("me"), asked(c));
    const bytes = performanceWorkbook(report);
    return c.body(new Uint8Array(bytes), 200, {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="sales-performance-${report.from}-to-${report.to}.xlsx"`,
    });
  });

  app.get("/api/team/sales", async (c) =>
    c.json(await teamSales(db, c.get("me"), c.req.query("month"))),
  );
  app.get("/api/ceo/home", async (c) =>
    c.json(
      await ceoHome(db, c.get("me"), c.req.query("month"), {
        from: c.req.query("from"),
        to: c.req.query("to"),
      }),
    ),
  );
  app.get("/api/company/tree", async (c) =>
    c.json(await companyTree(db, c.get("me"), c.req.query("month"))),
  );
  app.get("/api/channel-sales/:code", async (c) => {
    allow(c.get("me"), ["ceo", "admin", "management", "finance"], "see sales by channel");
    const facts = monthFacts(c.req.query("month"));
    return c.json(await channelSalesDetail(db, facts, c.req.param("code")));
  });
  app.get("/api/channel-sales", async (c) => {
    allow(c.get("me"), ["ceo", "admin", "management", "finance"], "see sales by channel");
    const facts = monthFacts(c.req.query("month"));
    return c.json({ ...facts, channels: await channelSales(db, facts) });
  });
}
