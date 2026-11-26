// BIR compliance API routes under /api/books/bir/* (guarded by signedIn + LEDGER_ROLES + FINANCE_BIR_ENABLED).

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import { mayReadLedger } from "../books/accounts";
import type { Database } from "../db/index";
import { type Env, readBody, Refusal } from "../http";
import { buildListDat } from "./dat";
import { render1702qPdf, render2307Pdf, render2550qPdf, renderWithholdingPdf } from "./pdf";
import { calendarQuarter, monthPeriod, quarter } from "./periods";
import { birReadiness } from "./readiness";
import {
  assertBirEnabled,
  birSettings,
  cashDisbursementsBook,
  cashReceiptsBook,
  compensation1601c,
  filingLogList,
  form0619e,
  form1601eq,
  form1604e,
  form2307,
  incomeTax1702q,
  parseCompany,
  purchaseJournal,
  qapReport,
  salesJournal,
  saveAccountMap,
  saveFilingLog,
  saveTaxpayerProfile,
  sawtReport,
  sliReport,
  slpReport,
  slsReport,
  taxpayerProfile,
  vatReturn2550q,
  withheldSuppliers,
} from "./reports";

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid YYYY-MM-DD date.");

const intQuery = (raw: string | undefined, fallback: number, min: number, max: number, field: string): number => {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Refusal(400, "invalid", `Invalid ${field}.`, field);
  }
  return n;
};

const dayRange = (fromRaw?: string, toRaw?: string) => {
  const now = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const y = Number(now.slice(0, 4));
  const m = Number(now.slice(5, 7));
  const q = Math.floor((m - 1) / 3) + 1;
  const def = calendarQuarter(y, q);
  const from = fromRaw && /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : def.start;
  const to = toRaw && /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : def.end;
  if (from > to) throw new Refusal(400, "invalid", "From date cannot come after To date.", "from");
  return { from, to };
};

export function birRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/books/bir/*", async (c, next) => {
    if (process.env.FINANCE_BIR_ENABLED === "false") {
      return c.json({ error: { code: "disabled", message: "BIR compliance module is temporarily turned off." } }, 503);
    }
    return next();
  });
  app.use("/api/books/bir/*", signedIn);

  app.get("/api/books/bir/settings", async (c) => c.json(await birSettings(db, c.get("me"))));

  app.post("/api/books/bir/settings/profile", async (c) => {
    const input = await readBody(
      c,
      z.object({
        company: z.enum(["2mg", "gpi"]),
        registeredName: z.string().trim().min(1).max(200),
        tradeName: z.string().trim().min(1).max(200),
        tin: z.string().max(30).nullish(),
        branchCode: z.string().max(10).nullish(),
        rdoCode: z.string().max(10).nullish(),
        address: z.string().max(400).nullish(),
        regime: z.enum(["vat", "non_vat"]).optional(),
        fiscalMonthEnd: z.number().int().min(1).max(12).optional(),
        isTamp: z.boolean().optional(),
      }),
    );
    return c.json(await saveTaxpayerProfile(db, c.get("me"), input.company, input));
  });

  app.post("/api/books/bir/settings/account-map", async (c) => {
    const input = await readBody(
      c,
      z.object({
        company: z.enum(["2mg", "gpi"]),
        entries: z.array(z.object({ roleKey: z.string().max(60), accountName: z.string().max(200) })).max(50),
      }),
    );
    await saveAccountMap(db, c.get("me"), input.company, input.entries);
    return c.json({ ok: true });
  });

  app.get("/api/books/bir/readiness", async (c) => {
    const company = parseCompany(c.req.query("company"));
    const { from, to } = dayRange(c.req.query("from"), c.req.query("to"));
    return c.json(await birReadiness(db, c.get("me"), company, from, to));
  });

  app.get("/api/books/bir/books/:book", async (c) => {
    assertBirEnabled();
    mayReadLedger(c.get("me"));
    const company = parseCompany(c.req.query("company"));
    const { from, to } = dayRange(c.req.query("from"), c.req.query("to"));
    const book = c.req.param("book");
    if (book === "sales") return c.json(await salesJournal(db, company, from, to));
    if (book === "purchases") return c.json(await purchaseJournal(db, company, from, to));
    if (book === "receipts") return c.json(await cashReceiptsBook(db, company, from, to));
    if (book === "disbursements") return c.json(await cashDisbursementsBook(db, company, from, to));
    throw new Refusal(404, "not_found", "No such BIR book.");
  });

  const periodFromQuery = (c: { req: { query: (k: string) => string | undefined } }, calendarOnly = false, fiscalEnd = 12) => {
    const year = intQuery(c.req.query("year"), 2026, 2000, 2100, "year");
    const monthRaw = c.req.query("month");
    if (monthRaw) {
      const month = intQuery(monthRaw, 1, 1, 12, "month");
      return { year, q: Math.floor((month - 1) / 3) + 1, month, period: monthPeriod(year, month) };
    }
    const q = intQuery(c.req.query("q"), 1, 1, 4, "q");
    return { year, q, month: null, period: calendarOnly ? calendarQuarter(year, q) : quarter(year, q, fiscalEnd) };
  };

  app.get("/api/books/bir/lists/:list", async (c) => {
    assertBirEnabled();
    mayReadLedger(c.get("me"));
    const company = parseCompany(c.req.query("company"));
    const list = c.req.param("list");
    const profile = await taxpayerProfile(db, company);
    const isWithholding = list === "qap" || list === "sawt";
    const { year, q, month, period } = periodFromQuery(c, isWithholding, profile.fiscalMonthEnd);
    const form = (c.req.query("form") as "all" | "1702Q" | "2550Q" | undefined) ?? "all";

    if (list === "sls") return c.json({ company, year, q, month, period, ...(await slsReport(db, company, period)) });
    if (list === "slp") return c.json({ company, year, q, month, period, ...(await slpReport(db, company, period)) });
    if (list === "sli") return c.json({ company, year, q, month, period, ...(await sliReport(db, company, period)) });
    if (list === "qap") return c.json({ company, year, q, month, ...(await qapReport(db, company, year, q)) });
    if (list === "sawt") return c.json({ company, year, q, month, period, ...(await sawtReport(db, company, period, form)) });
    throw new Refusal(404, "not_found", "No such BIR summary list.");
  });

  app.get("/api/books/bir/dat/:list", async (c) => {
    assertBirEnabled();
    mayReadLedger(c.get("me"));
    const company = parseCompany(c.req.query("company"));
    const list = c.req.param("list");
    if (!["sls", "slp", "qap", "sawt"].includes(list)) {
      throw new Refusal(404, "not_found", "Unsupported DAT export.");
    }
    const profile = await taxpayerProfile(db, company);
    const isWithholding = list === "qap" || list === "sawt";
    const { year, q, period } = periodFromQuery(c, isWithholding, profile.fiscalMonthEnd);
    const sawtForm = c.req.query("form") === "2550Q" ? "2550Q" : "1702Q";

    const data =
      list === "sls"
        ? await slsReport(db, company, period)
        : list === "slp"
          ? await slpReport(db, company, period)
          : list === "qap"
            ? await qapReport(db, company, year, q)
            : await sawtReport(db, company, period, sawtForm);

    if (data.missingTin > 0) {
      throw new Refusal(
        400,
        "invalid",
        `Cannot export ${list.toUpperCase()} .DAT: ${data.missingTin} row(s) are missing a valid 9-digit TIN. Fix them in BIR Readiness first.`,
      );
    }

    const { content, filename } = buildListDat(list as "sls" | "slp" | "qap" | "sawt", profile, period.end, data, sawtForm);
    return c.body(content, 200, {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-content-type-options": "nosniff",
    });
  });

  app.get("/api/books/bir/returns/2550q", async (c) => {
    assertBirEnabled();
    mayReadLedger(c.get("me"));
    const company = parseCompany(c.req.query("company"));
    const year = intQuery(c.req.query("year"), 2026, 2000, 2100, "year");
    const q = intQuery(c.req.query("q"), 1, 1, 4, "q");
    return c.json(await vatReturn2550q(db, company, year, q));
  });

  app.get("/api/books/bir/returns/0619e", async (c) => {
    assertBirEnabled();
    mayReadLedger(c.get("me"));
    const company = parseCompany(c.req.query("company"));
    const year = intQuery(c.req.query("year"), 2026, 2000, 2100, "year");
    const month = intQuery(c.req.query("month"), 1, 1, 12, "month");
    return c.json(await form0619e(db, company, year, month));
  });

  app.get("/api/books/bir/returns/1601eq", async (c) => {
    assertBirEnabled();
    mayReadLedger(c.get("me"));
    const company = parseCompany(c.req.query("company"));
    const year = intQuery(c.req.query("year"), 2026, 2000, 2100, "year");
    const q = intQuery(c.req.query("q"), 1, 1, 4, "q");
    return c.json(await form1601eq(db, company, year, q));
  });

  app.get("/api/books/bir/returns/1604e", async (c) => {
    assertBirEnabled();
    mayReadLedger(c.get("me"));
    const company = parseCompany(c.req.query("company"));
    const year = intQuery(c.req.query("year"), 2026, 2000, 2100, "year");
    return c.json(await form1604e(db, company, year));
  });

  app.get("/api/books/bir/returns/1702q", async (c) => {
    assertBirEnabled();
    mayReadLedger(c.get("me"));
    const company = parseCompany(c.req.query("company"));
    const year = intQuery(c.req.query("year"), 2026, 2000, 2100, "year");
    const q = intQuery(c.req.query("q"), 1, 1, 3, "q");
    const rateBp = intQuery(c.req.query("rateBp"), 2500, 2000, 2500, "rateBp");
    return c.json(await incomeTax1702q(db, company, year, q, rateBp));
  });

  app.get("/api/books/bir/returns/1601c", async (c) => {
    assertBirEnabled();
    mayReadLedger(c.get("me"));
    const company = parseCompany(c.req.query("company"));
    const year = intQuery(c.req.query("year"), 2026, 2000, 2100, "year");
    const month = intQuery(c.req.query("month"), 1, 1, 12, "month");
    return c.json(await compensation1601c(db, company, year, month));
  });

  app.get("/api/books/bir/returns/:form/pdf", async (c) => {
    assertBirEnabled();
    mayReadLedger(c.get("me"));
    const company = parseCompany(c.req.query("company"));
    const form = c.req.param("form").toLowerCase();
    const year = intQuery(c.req.query("year"), 2026, 2000, 2100, "year");

    let bytes: Uint8Array;
    let filename: string;
    if (form === "2550q") {
      const q = intQuery(c.req.query("q"), 1, 1, 4, "q");
      const data = await vatReturn2550q(db, company, year, q);
      if (data.form !== "2550Q") throw new Refusal(400, "invalid", "Non-VAT profile does not use 2550Q PDF.");
      bytes = await render2550qPdf(data);
      filename = `${company}-2550Q-${year}-Q${q}-draft.pdf`;
    } else if (form === "0619e") {
      const month = intQuery(c.req.query("month"), 1, 1, 12, "month");
      if (month % 3 === 0) throw new Refusal(400, "invalid", "Month 3 of each quarter belongs on 1601-EQ, not 0619-E.");
      bytes = await renderWithholdingPdf(await form0619e(db, company, year, month));
      filename = `${company}-0619E-${year}-${String(month).padStart(2, "0")}-draft.pdf`;
    } else if (form === "1601eq") {
      const q = intQuery(c.req.query("q"), 1, 1, 4, "q");
      bytes = await renderWithholdingPdf(await form1601eq(db, company, year, q));
      filename = `${company}-1601EQ-${year}-Q${q}-draft.pdf`;
    } else if (form === "1604e") {
      bytes = await renderWithholdingPdf(await form1604e(db, company, year));
      filename = `${company}-1604E-${year}-draft.pdf`;
    } else if (form === "1702q") {
      const q = intQuery(c.req.query("q"), 1, 1, 3, "q");
      const rateBp = intQuery(c.req.query("rateBp"), 2500, 2000, 2500, "rateBp");
      bytes = await render1702qPdf(await incomeTax1702q(db, company, year, q, rateBp));
      filename = `${company}-1702Q-${year}-Q${q}-draft.pdf`;
    } else {
      throw new Refusal(404, "not_found", "No PDF template for that BIR form.");
    }

    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "x-content-type-options": "nosniff",
    });
  });

  app.get("/api/books/bir/2307/suppliers", async (c) => {
    assertBirEnabled();
    mayReadLedger(c.get("me"));
    const company = parseCompany(c.req.query("company"));
    const year = intQuery(c.req.query("year"), 2026, 2000, 2100, "year");
    const q = intQuery(c.req.query("q"), 1, 1, 4, "q");
    return c.json({ company, year, q, suppliers: await withheldSuppliers(db, company, year, q) });
  });

  app.get("/api/books/bir/2307", async (c) => {
    assertBirEnabled();
    mayReadLedger(c.get("me"));
    const company = parseCompany(c.req.query("company"));
    const year = intQuery(c.req.query("year"), 2026, 2000, 2100, "year");
    const q = intQuery(c.req.query("q"), 1, 1, 4, "q");
    const month = c.req.query("month") ? intQuery(c.req.query("month"), 1, 1, 12, "month") : null;
    const supplierId = c.req.query("supplierId") || null;
    const docId = c.req.query("docId") ? intQuery(c.req.query("docId"), 1, 1, 1_000_000_000, "docId") : null;
    return c.json(await form2307(db, company, { year, q, month, supplierId, docId }));
  });

  app.get("/api/books/bir/2307/pdf", async (c) => {
    assertBirEnabled();
    mayReadLedger(c.get("me"));
    const company = parseCompany(c.req.query("company"));
    const year = intQuery(c.req.query("year"), 2026, 2000, 2100, "year");
    const q = intQuery(c.req.query("q"), 1, 1, 4, "q");
    const month = c.req.query("month") ? intQuery(c.req.query("month"), 1, 1, 12, "month") : null;
    const supplierId = c.req.query("supplierId") || null;
    const docId = c.req.query("docId") ? intQuery(c.req.query("docId"), 1, 1, 1_000_000_000, "docId") : null;
    const data = await form2307(db, company, { year, q, month, supplierId, docId });
    const bytes = await render2307Pdf(data);
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${company}-2307-${year}-Q${q}${month ? `-M${month}` : ""}-draft.pdf"`,
      "x-content-type-options": "nosniff",
    });
  });

  app.get("/api/books/bir/filing-log", async (c) =>
    c.json({ rows: await filingLogList(db, c.get("me"), parseCompany(c.req.query("company"))) }),
  );

  app.post("/api/books/bir/filing-log", async (c) => {
    const input = await readBody(
      c,
      z.object({
        company: z.enum(["2mg", "gpi"]),
        formCode: z.string().trim().min(1).max(30),
        periodLabel: z.string().trim().min(1).max(60),
        periodFrom: DAY,
        periodTo: DAY,
        filedOn: DAY.nullish(),
        referenceNo: z.string().max(80).nullish(),
        amountDueCentavos: z.number().int().nullish(),
        status: z.enum(["draft", "filed", "paid", "amended"]),
        notes: z.string().max(500).nullish(),
      }),
    );
    return c.json(await saveFilingLog(db, c.get("me"), input));
  });
}
