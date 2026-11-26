// Bishnoi One's companies (Aryan, 26 Nov 2026). Each company's data is in a database of its own,
// and one more database lists them (migrations-control): its six-digit Org ID, name, short code,
// the email domain its people sign in with, and where its data is. A company's login ID is the one
// Aryan types for it (info@2mginc.com): an email on its own domain, the login of its first System
// admin, opening all its apps with a one-time password they then change. A request is answered by its
// company's own app on its own database (companies/router.ts), so nothing of one company can reach
// another's: not a figure, a person or a file's name.
//
// The server's own database (DATABASE_URL) is the first company's: 2MG Inc. Every other company
// gets a database on the same Postgres server ("co_" and its Org ID), made when it is added in the
// control panel. On a developer's computer each is a PGlite folder beside .data/pg.

import { randomInt } from "node:crypto";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import { accountEvent } from "../account/events";
import { hashPassword } from "../auth/password";
import { type Database, openDatabase, rows } from "../db/index";
import { CONTROL_DIR, migrate } from "../db/migrate";
import { ensureCompanyTree, makeFirstAdmin } from "../first-admin";
import { Refusal } from "../http";
import { freshPassword } from "../org/service";
import { asCompany, type CompanyRef } from "./context";
import { copyStock, type StockCopied } from "./copy-stock";

export type CompanyRow = {
  id: number;
  orgId: string;
  name: string;
  code: string;
  loginDomain: string;
  /** Null: the server's own database (the first company). */
  database: string | null;
  pausedAt: Date | null;
  pausedReason: string | null;
  createdAt: Date;
};

/** What answers a company's requests: its own app (app.ts) on its own database. */
export type Answerer = { fetch: (request: Request, env?: unknown) => Response | Promise<Response> };

export type Running = { row: CompanyRow; ref: CompanyRef; db: Database; app: Answerer };

/** Where the databases are. */
export type Places = {
  /** A company's database by its name in the list (null: the server's own). Opened once. */
  open(database: string | null): Database;
  /** Makes a new, empty database for a company and gives its name. */
  make(orgId: string): Promise<string>;
  /** The list's own database (made if missing). */
  control(): Promise<Database>;
};

const ORG_ID = /^[1-9][0-9]{5}$/;
const DB_NAME = /^co[_-][1-9][0-9]{5}$/;
export const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
export const CODE = /^[A-Z0-9]{2,8}$/;
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
/** A company's login ID is on its own domain: a free mail service's domain is everybody's (all its
 *  users would be sent to that one company to sign in). */
const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "zoho.com", "yandex.com"]);
const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1);

function cached(open: (name: string | null) => Database) {
  const opened = new Map<string, Database>();
  return (name: string | null) => {
    const key = name ?? "";
    let db = opened.get(key);
    if (!db) {
      db = open(name);
      opened.set(key, db);
    }
    return db;
  };
}

const withDatabase = (url: string, name: string) => {
  const address = new URL(url);
  address.pathname = `/${name}`;
  return address.toString();
};

/** Online: one Postgres server, each company a database on it; the list in "bishnoi_control". */
export function postgresPlaces(mainUrl: string, controlUrl = process.env.CONTROL_DATABASE_URL): Places {
  const open = cached((name) => openDatabase({ url: name ? withDatabase(mainUrl, name) : mainUrl }));
  const ensure = async (name: string) => {
    if (!DB_NAME.test(name) && name !== "bishnoi_control") throw new Error(`Not a company database's name: ${name}`);
    const [found] = await rows(open(null), sql`select 1 as one from pg_database where datname = ${name}`);
    // The name is "co_" and six digits (or the list's own), checked just above.
    if (!found) await open(null).execute(sql.raw(`create database "${name}"`)); // nosemgrep
  };
  return {
    open,
    async make(orgId) {
      const name = `co_${orgId}`;
      await ensure(name);
      return name;
    },
    async control() {
      if (controlUrl) return openDatabase({ url: controlUrl });
      await ensure("bishnoi_control");
      return openDatabase({ url: withDatabase(mainUrl, "bishnoi_control") });
    },
  };
}

/** On a developer's computer: PGlite folders beside the first company's (.data/pg). */
export function folderPlaces(mainDir: string): Places {
  const base = dirname(mainDir);
  const open = cached((name) => openDatabase({ dir: name ? join(base, name) : mainDir }));
  return {
    open,
    async make(orgId) {
      return `co-${orgId}`;
    },
    async control() {
      return openDatabase({ dir: join(base, "control") });
    },
  };
}

/** Tests: every database in memory. */
export function memoryPlaces(main?: Database): Places {
  const open = cached((name) => (name === null && main ? main : openDatabase({ dir: "memory" })));
  let control: Database | null = null;
  return {
    open,
    async make(orgId) {
      return `co-${orgId}`;
    },
    async control() {
      control ??= openDatabase({ dir: "memory" });
      return control;
    },
  };
}

const COMPANY_COLUMNS = sql`id::int as id, org_id as "orgId", name, code, login_domain as "loginDomain",
  database, paused_at as "pausedAt", paused_reason as "pausedReason", created_at as "createdAt"`;

const refOf = (row: CompanyRow): CompanyRef => ({
  orgId: row.orgId,
  name: row.name,
  code: row.code,
  loginDomain: row.loginDomain,
  home: row.database === null,
});

export type NewCompany = {
  name: string;
  code: string;
  /** Its login ID, typed by Aryan: an email on its own domain (info@getmeds.ph). The domain after
   *  the @ is the one all its people sign in with. */
  loginId: string;
  /** The Org ID of a company whose stock it starts with (companies/copy-stock.ts). */
  copyStockFrom?: string | null;
};

export type CompanyChange = { name?: string; code?: string; loginId?: string };

export type CompanyList = Awaited<ReturnType<typeof openCompanies>>;

/** A new six-digit Org ID nobody has: made at random, so it says nothing of when or who. */
async function freshOrgId(control: Database): Promise<string> {
  for (let i = 0; i < 100; i += 1) {
    const id = String(randomInt(100_000, 1_000_000));
    const [taken] = await rows(control, sql`select 1 as one from company where org_id = ${id}`);
    if (!taken) return id;
  }
  throw new Error("No free Org ID found.");
}

/**
 * Opens the list and every company on it, each readied by `ready` (its database brought up to date,
 * its app made). On the first start with the list, the server's own database becomes its first
 * company, named by `home`.
 */
export async function openCompanies(options: {
  control: Database;
  places: Places;
  /** The first company as it is put on the list at the list's first start; `loginId` (Aryan, 26 Nov:
   *  info@2mginc.com) becomes its System admin's login then, once. */
  home: { name: string; code: string; loginDomain: string; loginId?: string };
  ready: (db: Database, ref: CompanyRef) => Promise<Answerer>;
}) {
  const { control, places } = options;
  await migrate(control, CONTROL_DIR);

  const [any] = await rows(control, sql`select 1 as one from company limit 1`);
  const firstStart = !any;
  if (firstStart)
    await control.execute(
      sql`insert into company (org_id, name, code, login_domain, database)
        values (${await freshOrgId(control)}, ${options.home.name}, ${options.home.code.toUpperCase()},
          ${options.home.loginDomain.toLowerCase()}, null)`,
    );

  const running = new Map<string, Running>();
  /** Companies on the list whose database couldn't be opened: refused, never sent elsewhere. */
  const broken = new Map<string, string>();

  async function start(row: CompanyRow): Promise<Running> {
    const db = places.open(row.database);
    const ref = refOf(row);
    const app = await options.ready(db, ref);
    const one = { row, ref, db, app };
    running.set(row.orgId, one);
    broken.delete(row.orgId);
    return one;
  }

  const companyRows = () => rows<CompanyRow>(control, sql`select ${COMPANY_COLUMNS} from company order by id`);
  const rowOf = async (orgId: string) =>
    (await rows<CompanyRow>(control, sql`select ${COMPANY_COLUMNS} from company where org_id = ${orgId}`))[0] ?? null;

  for (const row of await companyRows()) {
    try {
      await start(row);
    } catch (error) {
      // One company's database down never stops the others; its people are told it can't be reached.
      if (row.database === null) throw error;
      broken.set(row.orgId, error instanceof Error ? error.message : String(error));
      console.error(`[${row.code}] couldn't start`, error);
    }
  }
  const homeOne = [...running.values()].find((one) => one.ref.home);
  if (!homeOne) throw new Error("The first company (the server's own database) isn't on the list.");

  /** The row as it is now, kept on its running company too. */
  async function refresh(orgId: string): Promise<Running> {
    const row = await rowOf(orgId);
    const one = running.get(orgId);
    if (!row || !one) throw new Refusal(404, "not_found", "No such company.");
    one.row = row;
    one.ref = refOf(row);
    return one;
  }

  async function event(by: number | null, companyId: number | null, what: string, detail: object = {}) {
    await control.execute(
      sql`insert into control_event (person_id, company_id, what, detail) values (${by}, ${companyId}, ${what}, ${JSON.stringify(detail)}::jsonb)`,
    );
  }

  /** Name, code and login ID: checked as a form checks them, every wrong one named. */
  async function check(input: { name?: string; code?: string; loginId?: string }, except: number | null) {
    const fields: Record<string, string> = {};
    if (input.name !== undefined && (!input.name.trim() || input.name.trim().length > 120))
      fields.name = "Give the company's name (at most 120 letters).";
    if (input.code !== undefined) {
      if (!CODE.test(input.code)) fields.code = "2 to 8 capital letters or digits, like 2MG or GM.";
      else {
        const [taken] = await rows(control, sql`select 1 as one from company where code = ${input.code} and id is distinct from ${except}`);
        if (taken) fields.code = "Another company has this code.";
      }
    }
    if (input.loginId !== undefined) {
      const domain = domainOf(input.loginId);
      if (!EMAIL.test(input.loginId) || !DOMAIN.test(domain)) fields.loginId = "An email on the company's own domain, like info@getmeds.ph.";
      else if (FREE_MAIL.has(domain)) fields.loginId = `Use an email on the company's own domain (like info@getmeds.ph), not @${domain}.`;
      else {
        const [taken] = await rows(control, sql`select 1 as one from company where login_domain = ${domain} and id is distinct from ${except}`);
        if (taken) fields.loginId = `Another company signs in with @${domain}.`;
      }
    }
    const first = Object.keys(fields)[0];
    if (first) throw new Refusal(400, "invalid", fields[first] as string, first, fields);
  }

  /** The company's login: its first System admin still working, and the ID they sign in with (their
   *  email; else their seat's login ID with the company's domain). */
  async function adminOf(one: Running) {
    const [admin] = await rows<{ id: number; login: string | null }>(
      one.db,
      sql`select p.id::int as id,
          coalesce(lower(p.email), (select s.login || '@' || ${one.ref.loginDomain} from seat_holder h join seat s on s.id = h.seat_id
            where h.person_id = p.id and s.login is not null order by h.id limit 1)) as login
        from person p where p.role = 'admin' and p.active order by p.id limit 1`,
    );
    return admin ?? null;
  }

  const companies = {
    all: () => [...running.values()],
    home: () => homeOne,
    byOrgId: (orgId: string | undefined | null) => (orgId && ORG_ID.test(orgId) && running.get(orgId)) || null,
    byDomain: (domain: string) => [...running.values()].find((one) => one.ref.loginDomain === domain) ?? null,
    /** Why a company on the list isn't answering, if it isn't. */
    brokenWhy: (orgId: string | undefined | null) => (orgId && broken.get(orgId)) || null,
    isBrokenDomain: async (domain: string) => {
      const [found] = await rows<{ orgId: string }>(control, sql`select org_id as "orgId" from company where login_domain = ${domain}`);
      return found ? broken.has(found.orgId) : false;
    },
    rows: companyRows,
    rowOf,
    event,
    adminOf,

    /** Adds a company: its database, its first System admin (with a one-time password), its tree, and
     *  if asked, another company's stock. */
    async add(input: NewCompany, by: number | null) {
      const name = input.name.trim();
      const code = input.code.trim().toUpperCase();
      const login = input.loginId.trim().toLowerCase();
      await check({ name, code, loginId: login }, null);
      const loginDomain = domainOf(login);
      const from = input.copyStockFrom ? running.get(input.copyStockFrom) : null;
      if (input.copyStockFrom && !from) throw new Refusal(400, "invalid", "That company isn't on the list.", "copyStockFrom");

      const orgId = await freshOrgId(control);
      const database = await places.make(orgId);
      const db = places.open(database);
      await migrate(db);
      const ref: CompanyRef = { orgId, name, code, loginDomain, home: false };
      const password = freshPassword();
      let stock: StockCopied | null = null;
      await asCompany(ref, async () => {
        if (!(await makeFirstAdmin(db, login, password)))
          throw new Refusal(409, "not_empty", "The new company's database isn't empty. Nothing was added.");
        const [admin] = await rows<{ id: number }>(db, sql`select id::int as id from person where email = ${login}`);
        await ensureCompanyTree(db, name);
        if (from) stock = await copyStock(from.db, db, admin?.id as number, from.ref.name);
      });

      const [made] = await rows<{ id: number }>(
        control,
        sql`insert into company (org_id, name, code, login_domain, database)
          values (${orgId}, ${name}, ${code}, ${loginDomain}, ${database}) returning id::int as id`,
      );
      await event(by, made?.id ?? null, "added", { name, code, loginId: login, stockFrom: from?.ref.name ?? null, stock });
      const one = await start((await rowOf(orgId)) as CompanyRow);
      return { company: one, loginId: login, password, stock: stock as StockCopied | null };
    },

    /** Its name, code or login ID. A new login ID becomes its System admin's (their email), and its
     *  domain the one all its people sign in with. */
    async change(orgId: string, input: CompanyChange, by: number | null) {
      const before = await rowOf(orgId);
      const one = running.get(orgId);
      if (!before || !one) throw new Refusal(404, "not_found", "No such company, or it can't be reached now.");
      const admin = await adminOf(one);
      const login = input.loginId?.trim().toLowerCase();
      const newLogin = login !== undefined && login !== admin?.login ? login : undefined;
      const next = {
        name: input.name?.trim() ?? before.name,
        code: input.code?.trim().toUpperCase() ?? before.code,
        loginDomain: newLogin ? domainOf(newLogin) : before.loginDomain,
      };
      await check({ name: next.name, code: next.code, ...(newLogin ? { loginId: newLogin } : {}) }, before.id);
      if (newLogin) {
        if (!admin) throw new Refusal(409, "no_admin", "This company has no System admin working.");
        const [other] = await rows(one.db, sql`select 1 as one from person where lower(email) = ${newLogin} and id <> ${admin.id}`);
        if (other)
          throw new Refusal(409, "taken", `Someone else at ${before.name} has ${newLogin} as their email.`, "loginId", {
            loginId: `Someone else at ${before.name} has ${newLogin} as their email.`,
          });
        await one.db.transaction(async (tx) => {
          await tx.execute(sql`update person set email = ${newLogin} where id = ${admin.id}`);
          await accountEvent(tx, admin.id, null, "contact", `Login ID set to ${newLogin} from Bishnoi One's control panel`);
        });
      }
      await control.execute(
        sql`update company set name = ${next.name}, code = ${next.code}, login_domain = ${next.loginDomain} where id = ${before.id}`,
      );
      const changed: Record<string, { was: string | null; now: string }> = {};
      if (next.name !== before.name) changed.name = { was: before.name, now: next.name };
      if (next.code !== before.code) changed.code = { was: before.code, now: next.code };
      if (newLogin) changed.loginId = { was: admin?.login ?? null, now: newLogin };
      if (Object.keys(changed).length) await event(by, before.id, "changed", changed);
      return refresh(orgId);
    },

    async pause(orgId: string, reason: string, by: number | null) {
      const row = await rowOf(orgId);
      if (!row) throw new Refusal(404, "not_found", "No such company.");
      if (row.database === null) throw new Refusal(409, "home", "The first company (the server's own) can't be paused.");
      if (!row.pausedAt) {
        await control.execute(sql`update company set paused_at = now(), paused_reason = ${reason.trim() || null} where id = ${row.id}`);
        await event(by, row.id, "paused", { reason: reason.trim() || null });
      }
      return refresh(orgId);
    },

    async resume(orgId: string, by: number | null) {
      const row = await rowOf(orgId);
      if (!row) throw new Refusal(404, "not_found", "No such company.");
      if (row.pausedAt) {
        await control.execute(sql`update company set paused_at = null, paused_reason = null where id = ${row.id}`);
        await event(by, row.id, "resumed");
      }
      return refresh(orgId);
    },

    /** A new one-time password for the company's System admin: they choose their own after it.
     *  Their two-step sign-in, if on, stays on (as an Admin's own reset of anyone's password). */
    async newAdminPassword(orgId: string, by: number | null) {
      const one = running.get(orgId);
      if (!one) throw new Refusal(404, "not_found", "No such company, or it can't be reached now.");
      const admin = await adminOf(one);
      if (!admin) throw new Refusal(409, "no_admin", "This company has no System admin working.");
      const password = freshPassword();
      const hash = await hashPassword(password);
      await one.db.transaction(async (tx) => {
        await tx.execute(
          sql`update person set password_hash = ${hash}, must_change_password = true, password_pending = false,
            failed_logins = 0, locked_until = null where id = ${admin.id}`,
        );
        // Signed out everywhere: the old password's sessions end with it.
        await tx.execute(sql`delete from session where person_id = ${admin.id} or viewed_by = ${admin.id}`);
        await accountEvent(tx, admin.id, null, "password_given", "From Bishnoi One's control panel");
      });
      await event(by, one.row.id, "admin_password", { loginId: admin.login });
      return { loginId: admin.login, password };
    },
  };

  // The list's first start: the first company's login ID as Aryan gave it (info@2mginc.com), once.
  // Never again on later starts, so a change made in the panel stays.
  const homeLogin = options.home.loginId?.trim().toLowerCase();
  if (firstStart && homeLogin)
    await companies.change(homeOne.ref.orgId, { loginId: homeLogin }, null).catch((error: unknown) => {
      console.error(`[${homeOne.ref.code}] its login ID couldn't be set to ${homeLogin}: ${error instanceof Error ? error.message : String(error)}`);
    });
  return companies;
}
