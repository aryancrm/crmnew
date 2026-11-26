// The company's own settings: what its papers print (the letterhead on a quotation) and how its
// points work. The Admin and the CEO change them; everyone's screens read them.

import { sql } from "drizzle-orm";
import { companyNow, homeInvoiceSeries } from "../companies/context";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import type { Runner } from "../inventory/service";
import { type CompanyCode, OWN } from "../companies";
import type { CaseMailSettings, CompanyInfo, Letterhead, Me, PointsProgram } from "../types";

export const SETTING_ROLES = ["admin", "ceo"] as const;

const COMPANY_DEFAULT: CompanyInfo = {
  name: "2MG Inc.",
  address: "",
  phone: "",
  email: "",
  tin: "",
  vat: true,
  licence: "",
  footer: "",
  signatory: "",
  signatoryTitle: "",
  invoiceSeries: "",
};
const POINTS_DEFAULT: PointsProgram = { enabled: false, rateBps: 1000 };
/** Off until the Admin switches them on (the old CRM's owner's choice), then every step. */
const CASE_MAIL_DEFAULT: CaseMailSettings = {
  enabled: false,
  events: { enquiry: true, quotation: true, gl_received: true, gl_verified: true },
};

async function read<T>(db: Runner, key: string, fallback: T): Promise<T> {
  const [found] = await rows<{ value: T }>(db, sql`select value from setting where key = ${key}`);
  return found ? { ...fallback, ...found.value } : fallback;
}

/**
 * The company's own details: what its quotations, invoices, payslips and HR's papers print. One
 * company per database since the separation (Aryan, 26 Nov night: "everything separate"): until
 * they are saved, it is named as on Bishnoi One's list, and 2MG's invoices keep their series.
 */
export const companyInfo = async (db: Runner): Promise<CompanyInfo> => {
  const found = await read<CompanyInfo>(db, "company", {
    ...COMPANY_DEFAULT,
    name: companyNow()?.name ?? COMPANY_DEFAULT.name,
    invoiceSeries: homeInvoiceSeries() ?? "",
  });
  return { ...found, invoiceSeries: found.invoiceSeries || homeInvoiceSeries() || "" };
};

/** Its letterhead on HR's papers: the name, address, phone, email, TIN and foot line in its own
 *  Company details (the code a row carries no longer picks another company's: there is none). */
export async function letterheadOf(db: Runner, _code?: CompanyCode | string | null): Promise<Letterhead> {
  const details = await companyInfo(db);
  return {
    code: OWN,
    name: details.name,
    address: details.address,
    phone: details.phone,
    email: details.email,
    tin: details.tin,
    footer: details.footer,
  };
}

export const pointsProgram = (db: Runner) => read<PointsProgram>(db, "points", POINTS_DEFAULT);

/** Which of a case's own steps email the customer by themselves (online/case-mail.ts). */
export async function caseMailSettings(db: Runner): Promise<CaseMailSettings> {
  const saved = await read<CaseMailSettings>(db, "case_emails", CASE_MAIL_DEFAULT);
  return { enabled: saved.enabled, events: { ...CASE_MAIL_DEFAULT.events, ...saved.events } };
}

export async function saveCaseMail(db: Database, me: Me, input: CaseMailSettings): Promise<void> {
  allow(me, SETTING_ROLES, "change the automatic emails");
  await write(db, me, "case_emails", {
    enabled: input.enabled,
    events: Object.fromEntries(
      Object.keys(CASE_MAIL_DEFAULT.events).map((key) => [key, input.events[key as keyof CaseMailSettings["events"]] !== false]),
    ),
  });
}

async function write(db: Database, me: Me, key: string, value: unknown) {
  await db.execute(
    sql`insert into setting (key, value, updated_by) values (${key}, ${JSON.stringify(value)}::jsonb, ${me.id})
      on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
  );
}

export async function settingsOf(
  db: Database,
  me: Me,
): Promise<{
  company: CompanyInfo;
  points: PointsProgram;
  caseEmails: CaseMailSettings;
}> {
  allow(me, SETTING_ROLES, "see the settings");
  const [company, points, caseEmails] = await Promise.all([companyInfo(db), pointsProgram(db), caseMailSettings(db)]);
  return { company, points, caseEmails };
}

/** The Admin or the CEO saves the company's own details. */
export async function saveCompany(db: Database, me: Me, input: CompanyInfo): Promise<void> {
  allow(me, SETTING_ROLES, "change the company's details");
  if (!input.name.trim()) throw new Refusal(400, "invalid", "Type the company's name.", "name");
  if (input.tin && !/^[0-9-]{9,20}$/.test(input.tin.trim()))
    throw new Refusal(400, "invalid", "Type the TIN as digits, like 123-456-789-000.", "tin");
  const series = (input.invoiceSeries ?? "").trim();
  if (series && !/^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/.test(series))
    throw new Refusal(400, "invalid", "Letters, digits and dashes, up to 20 (like 2MG-SI-).", "invoiceSeries");
  // A series already printed on invoices stays: their numbers go on from it.
  const before = await companyInfo(db);
  if (before.invoiceSeries && series !== before.invoiceSeries) {
    const [issued] = await rows<{ n: number }>(db, sql`select count(*)::int as n from invoice where code like ${`${before.invoiceSeries}%`}`);
    if ((issued?.n ?? 0) > 0)
      throw new Refusal(409, "in_use", `Invoices are out under ${before.invoiceSeries}: it stays.`, "invoiceSeries");
  }
  const clean = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      typeof value === "string" ? value.trim() : value,
    ]),
  ) as CompanyInfo;
  await write(db, me, "company", { ...clean, invoiceSeries: series });
}

export async function savePointsProgram(db: Database, me: Me, input: PointsProgram): Promise<void> {
  allow(me, SETTING_ROLES, "change the points program");
  if (!Number.isInteger(input.rateBps) || input.rateBps < 0 || input.rateBps > 5000)
    throw new Refusal(400, "invalid", "Type a rate between 0% and 50%.", "rateBps");
  await write(db, me, "points", { enabled: input.enabled, rateBps: input.rateBps });
}
