// Customers' addresses. Everyone signed in may ask; the service decides which customers each
// person sees.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { allow, type Env, idParam, Refusal, readBody } from "../http";
import { customerFiles } from "./files";
import { customerPage } from "./page";
import { customerPrices } from "./prices";
import { refillsWaiting, reorders, setRefill } from "./reorders";
import {
  addCustomer,
  addCustomerPaper,
  CUSTOMER_ADD_ROLES,
  CUSTOMER_KINDS,
  CUSTOMER_MANAGE_ROLES,
  checkCustomer,
  customerDetail,
  listCustomers,
  myArea,
  readCustomerPaper,
  reviewCustomer,
  saveCustomer,
  saveCustomerCredit,
  toCollect,
} from "./service";

const text = (max: number) => z.string().trim().max(max, `Keep it under ${max} characters.`);
const optional = (max: number) => text(max).nullish();
const kind = z.enum(CUSTOMER_KINDS.map((entry) => entry.key) as [string, ...string[]], {
  error: "Pick what kind of customer this is.",
});

const customerInput = z.object({
  kind,
  name: text(160).min(2, "Type the customer's name."),
  phone: optional(40).refine(
    (value) => !value || value.replace(/\D/g, "").length >= 7,
    "That phone number is too short.",
  ),
  email: optional(160).refine(
    (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value),
    "That isn't an email address.",
  ),
  address: optional(300),
  city: optional(80),
  specialty: optional(80),
  worksAt: z.number().int().positive().nullish(),
  licenceNo: optional(60),
  licenceExpires: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.")
    .nullish()
    .or(z.literal("")),
  tin: optional(40),
  licenceOwner: optional(120),
  ltoType: optional(80),
  licenceIssued: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.")
    .nullish()
    .or(z.literal("")),
  note: optional(500),
  areaId: z.number().int().positive().nullish(),
  paymentTerms: z.enum(["advance", "cod", "days"]).optional(),
  paymentDays: z
    .number()
    .int("Use a whole number.")
    .min(1, "Use 1 day or more.")
    .max(365, "Use 365 days or fewer.")
    .nullish(),
  creditLimit: z.number().int().min(0, "Use zero or more.").max(100_000_000_00).nullish(),
});

export function customerRoutes(
  app: Hono<Env>,
  db: Database,
  signedIn: MiddlewareHandler<Env>,
): void {
  // "/path/*" also covers "/path" itself.
  for (const path of [
    "/api/customers/*",
    "/api/customer-papers/*",
    "/api/my/area",
    "/api/my/collect",
    "/api/my/reorders",
    "/api/my/refills-waiting",
  ])
    app.use(path, signedIn);

  app.get("/api/customers", async (c) => {
    const query = c.req.query();
    const picked = CUSTOMER_KINDS.find((entry) => entry.key === query.kind)?.key;
    return c.json(
      await listCustomers(db, c.get("me"), {
        kind: picked,
        q: query.q,
        page: Number(query.page) || 1,
        review: query.review === "1",
        medrep: Number(query.medrep) || undefined,
        sort: query.sort,
        owes: query.owes === "any" || query.owes === "overdue" ? query.owes : undefined,
        seat: Number(query.seat) || undefined,
      }),
    );
  });

  // Before /:id, so "check" is never read as an id.
  app.get("/api/customers/check", async (c) => {
    const query = c.req.query();
    const picked = CUSTOMER_KINDS.find((entry) => entry.key === query.kind)?.key;
    return c.json({
      matches: await checkCustomer(db, c.get("me"), {
        name: query.name,
        phone: query.phone,
        kind: picked,
        licence: query.licence,
      }),
    });
  });

  app.get("/api/customers/:id", async (c) =>
    c.json(await customerDetail(db, c.get("me"), idParam(c))),
  );
  app.get("/api/customers/:id/page", async (c) =>
    c.json(await customerPage(db, c.get("me"), idParam(c))),
  );
  // What they were given before, medicine by medicine (this CRM's orders and Zoho's).
  app.get("/api/customers/:id/prices", async (c) =>
    c.json(await customerPrices(db, c.get("me"), idParam(c), c.req.query("month"))),
  );

  // Customers from a spreadsheet (ERP phase 4): each row added as if typed by hand, with the same
  // checks (one customer per phone and kind, no twin by name and city). Checked first without
  // keeping anything; kept only with apply. Management and the Admin.
  app.post("/api/customers/import", async (c) => {
    const me = c.get("me");
    allow(me, CUSTOMER_MANAGE_ROLES, "import customers");
    const input = await readBody(
      c,
      z.object({
        rows: z.array(z.record(z.string(), z.unknown())).min(1, "The file has no rows.").max(2000, "At most 2,000 rows at a time."),
        apply: z.boolean().default(false),
      }),
    );
    const results: { row: number; name: string; ok: boolean; message: string | null }[] = [];
    const DRY = new Error("dry run");
    try {
      await db.transaction(async (tx) => {
        for (const [n, raw] of input.rows.entries()) {
          const parsed = customerInput.safeParse(importRow(raw));
          const name = String(raw.name ?? raw.Name ?? "").trim();
          if (!parsed.success) {
            const issue = parsed.error.issues[0];
            results.push({ row: n + 2, name, ok: false, message: `${issue?.path.join(".") || "row"}: ${issue?.message ?? "not readable"}` });
            continue;
          }
          try {
            await addCustomer(tx as unknown as Database, me, parsed.data as Parameters<typeof addCustomer>[2]);
            results.push({ row: n + 2, name, ok: true, message: null });
          } catch (error) {
            if (!(error instanceof Refusal)) throw error;
            results.push({ row: n + 2, name, ok: false, message: error.message });
          }
        }
        if (!input.apply) throw DRY;
      });
    } catch (error) {
      if (error !== DRY) throw error;
    }
    return c.json({ applied: input.apply, added: input.apply ? results.filter((one) => one.ok).length : 0, results });
  });

  app.post("/api/customers", async (c) => {
    allow(c.get("me"), CUSTOMER_ADD_ROLES, "add a customer");
    const input = await readBody(c, customerInput);
    return c.json({
      id: await addCustomer(db, c.get("me"), input as Parameters<typeof addCustomer>[2]),
    });
  });

  app.post("/api/customers/:id/credit", async (c) => {
    const input = await readBody(
      c,
      z.object({
        paymentTerms: z.enum(["advance", "cod", "days"], { error: "Pick how they pay." }),
        paymentDays: z.number().int().positive().max(365).nullish(),
        creditLimit: z.number().int().min(0).nullish(),
      }),
    );
    await saveCustomerCredit(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.post("/api/customers/:id", async (c) => {
    allow(c.get("me"), CUSTOMER_ADD_ROLES, "change a customer");
    const input = await readBody(c, customerInput);
    await saveCustomer(db, c.get("me"), idParam(c), input as Parameters<typeof saveCustomer>[3]);
    return c.json({ ok: true });
  });

  // A customer's files, a photo or PDF each: a business's papers (BIR 2303, LTO permit, business
  // permit), a patient's prescription and valid ID, or any other file.
  app.post("/api/customers/:id/papers", async (c) => {
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > 10 * 1024 * 1024 + 64 * 1024)
      throw new Refusal(400, "invalid", "That file is over 10 MB. Take the photo again.", "file");
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const file = body.file;
    if (!(file instanceof File)) throw new Refusal(400, "invalid", "Attach a photo or a PDF.", "file");
    const id = await addCustomerPaper(db, c.get("me"), idParam(c), {
      kind: String(body.kind ?? ""),
      name: file.name,
      mime: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return c.json({ id });
  });
  app.get("/api/customers/:id/files", async (c) => c.json(await customerFiles(db, c.get("me"), idParam(c))));
  app.get("/api/customer-papers/:id", async (c) => {
    const paper = await readCustomerPaper(db, c.get("me"), idParam(c));
    return c.body(paper.bytes as Uint8Array<ArrayBuffer>, 200, {
      "content-type": paper.mime,
      "content-disposition": `inline; filename="${encodeURIComponent(paper.name)}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=604800, immutable",
    });
  });

  // The next refill: the day the customer's medicines run out, set by whoever took the order.
  app.post("/api/customers/:id/refill", async (c) => {
    const input = await readBody(
      c,
      z.object({
        on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day.").nullable(),
        note: z.string().max(200).nullish(),
      }),
    );
    await setRefill(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });

  app.post("/api/customers/:id/review", async (c) => {
    allow(c.get("me"), CUSTOMER_MANAGE_ROLES, "review a new customer");
    await reviewCustomer(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });

  app.get("/api/my/area", async (c) => c.json(await myArea(db, c.get("me"))));
  app.get("/api/my/collect", async (c) => c.json(await toCollect(db, c.get("me"))));
  // The menu's count beside Refills due: due now, or within two days.
  app.get("/api/my/refills-waiting", async (c) => c.json(await refillsWaiting(db, c.get("me"))));
  app.get("/api/my/reorders", async (c) =>
    c.json(
      await reorders(db, c.get("me"), {
        state: c.req.query("state"),
        kind: c.req.query("kind"),
        area: Number(c.req.query("area")) || undefined,
      }),
    ),
  );
}

/** A spreadsheet row read by its headers ("Name", "Mobile", "Type"…) into the add form's fields. */
function importRow(raw: Record<string, unknown>): Record<string, unknown> {
  const pick = (...keys: string[]) => {
    for (const [key, value] of Object.entries(raw)) {
      const plain = key.toLowerCase().replace(/[^a-z]/g, "");
      if (keys.includes(plain)) {
        const text = String(value ?? "").trim();
        return text === "" ? null : text;
      }
    }
    return null;
  };
  const date = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  return {
    kind: pick("kind", "type", "customertype")?.toLowerCase() ?? null,
    name: pick("name", "customername", "customer") ?? "",
    phone: pick("phone", "mobile", "mobileno", "phoneno", "contactno", "contact"),
    email: pick("email", "emailaddress"),
    address: pick("address", "billingaddress"),
    city: pick("city", "billingcity", "town"),
    specialty: pick("specialty", "specialization"),
    licenceNo: pick("licenceno", "licenseno", "lto", "ltono", "ltonumber", "licence", "license"),
    licenceExpires: date(pick("licenceexpires", "licenseexpires", "ltoexpiry", "expiry")),
    tin: pick("tin", "tinno"),
    note: pick("note", "notes", "remarks"),
  };
}
