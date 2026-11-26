// The company's own settings: what its papers print (the letterhead on a quotation) and how its
// points work. The Admin and the CEO change them; everyone's screens read them.

import { sql } from "drizzle-orm";
import { companyNow } from "../companies/context";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import type { Runner } from "../inventory/service";
import type { CompanyInfo, Me, PointsProgram } from "../types";

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
};
const POINTS_DEFAULT: PointsProgram = { enabled: false, rateBps: 1000 };

async function read<T>(db: Runner, key: string, fallback: T): Promise<T> {
  const [found] = await rows<{ value: T }>(db, sql`select value from setting where key = ${key}`);
  return found ? { ...fallback, ...found.value } : fallback;
}

/** Until its details are saved, a company is named as on Bishnoi One's list (companies/context.ts). */
export const companyInfo = (db: Runner) =>
  read<CompanyInfo>(db, "company", { ...COMPANY_DEFAULT, name: companyNow()?.name ?? COMPANY_DEFAULT.name });
export const pointsProgram = (db: Runner) => read<PointsProgram>(db, "points", POINTS_DEFAULT);

async function write(db: Database, me: Me, key: string, value: unknown) {
  await db.execute(
    sql`insert into setting (key, value, updated_by) values (${key}, ${JSON.stringify(value)}::jsonb, ${me.id})
      on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
  );
}

export async function settingsOf(
  db: Database,
  me: Me,
): Promise<{ company: CompanyInfo; points: PointsProgram }> {
  allow(me, SETTING_ROLES, "see the settings");
  return { company: await companyInfo(db), points: await pointsProgram(db) };
}

export async function saveCompany(db: Database, me: Me, input: CompanyInfo): Promise<void> {
  allow(me, SETTING_ROLES, "change the company's details");
  if (!input.name.trim()) throw new Refusal(400, "invalid", "Type the company's name.", "name");
  if (input.tin && !/^[0-9-]{9,20}$/.test(input.tin.trim()))
    throw new Refusal(400, "invalid", "Type the TIN as digits, like 123-456-789-000.", "tin");
  const clean = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      typeof value === "string" ? value.trim() : value,
    ]),
  ) as CompanyInfo;
  await write(db, me, "company", clean);
}

export async function savePointsProgram(db: Database, me: Me, input: PointsProgram): Promise<void> {
  allow(me, SETTING_ROLES, "change the points program");
  if (!Number.isInteger(input.rateBps) || input.rateBps < 0 || input.rateBps > 5000)
    throw new Refusal(400, "invalid", "Type a rate between 0% and 50%.", "rateBps");
  await write(db, me, "points", { enabled: input.enabled, rateBps: input.rateBps });
}
