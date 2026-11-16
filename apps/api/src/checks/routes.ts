// The data checks' address: the Admin and the CEO run them.

import type { Hono, MiddlewareHandler } from "hono";
import type { Database } from "../db/index";
import type { Env } from "../http";
import { z } from "zod";
import { allow, readBody } from "../http";
import { importOldFiles, importOldLeads, type OldFile, type OldLead, type OldMessage } from "../online/legacy-import";
import { tieZohoSeller, zohoSellers } from "../zoho/sellers";
import { importZohoCustomers, importZohoOrders, zohoCustomer, zohoOrder } from "../zoho/import";
import { CHART_2026 } from "../org/chart-2026";
import { importChart } from "../org/chart-import";
import { dataChecks } from "./integrity";

export function checkRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.get("/api/admin/data-checks", signedIn, async (c) =>
    c.json(await dataChecks(db, c.get("me"))),
  );
  // The old CRM's enquiries, sent in batches by the Admin (dry run unless apply).
  app.post("/api/admin/import/old-leads", signedIn, async (c) => {
    allow(c.get("me"), ["admin"], "bring over the old CRM's enquiries");
    const body = await readBody(
      c,
      z.object({
        leads: z.array(z.record(z.string(), z.unknown())).max(500),
        messages: z.array(z.record(z.string(), z.unknown())).max(20_000),
        apply: z.boolean().optional(),
      }),
    );
    return c.json(
      await importOldLeads(
        db,
        body.leads as unknown as OldLead[],
        body.messages as unknown as OldMessage[],
        Boolean(body.apply),
      ),
    );
  });
  // The old CRM's photos: links to the old storage, fetched and kept here (dry run unless apply).
  app.post("/api/admin/import/old-files", signedIn, async (c) => {
    allow(c.get("me"), ["admin"], "bring over the old CRM's photos");
    const body = await readBody(
      c,
      z.object({
        files: z.array(z.record(z.string(), z.unknown())).max(100),
        apply: z.boolean().optional(),
      }),
    );
    return c.json(await importOldFiles(db, body.files as unknown as OldFile[], Boolean(body.apply)));
  });
  // Zoho's salespeople tied to seats: their customers come under the seat's area.
  app.get("/api/admin/zoho-sellers", signedIn, async (c) => c.json(await zohoSellers(db, c.get("me"))));
  app.post("/api/admin/zoho-sellers", signedIn, async (c) => {
    const body = await readBody(c, z.object({ name: z.string().min(1).max(200), seatId: z.number().int().positive().nullable() }));
    return c.json(await tieZohoSeller(db, c.get("me"), body.name, body.seatId));
  });
  // The chart's selling teams and seats (empty, for HR to fill), once.
  app.post("/api/admin/import/chart", signedIn, async (c) => {
    allow(c.get("me"), ["admin", "ceo"], "set up the chart's teams");
    const body = await readBody(c, z.object({ apply: z.boolean().optional() }));
    return c.json(await importChart(db, CHART_2026, Boolean(body.apply)));
  });
  // Zoho's customers, then its sales orders with their lines: history from before this CRM, sent
  // in batches by the Admin (dry run unless apply). Sending a batch again adds nothing.
  app.post("/api/admin/import/zoho-customers", signedIn, async (c) => {
    allow(c.get("me"), ["admin"], "bring over Zoho's customers");
    const body = await readBody(
      c,
      z.object({ customers: z.array(zohoCustomer).max(2000), apply: z.boolean().optional() }),
    );
    return c.json(await importZohoCustomers(db, body.customers, Boolean(body.apply)));
  });
  app.post("/api/admin/import/zoho-orders", signedIn, async (c) => {
    allow(c.get("me"), ["admin"], "bring over Zoho's sales orders");
    const body = await readBody(
      c,
      z.object({ orders: z.array(zohoOrder).max(1000), apply: z.boolean().optional() }),
    );
    return c.json(await importZohoOrders(db, body.orders, Boolean(body.apply)));
  });
}
