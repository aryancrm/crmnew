// Lines the companies' accounts up with HR's master data, with nobody added by hand (27 Nov 2026, the
// backend developer: "ready for production: check the database, then update it so the accounts are
// aligned; no manual adding"). HR's sheet ("HR Dashboard Project - UPDATED.xlsx", All Active
// Employees) is the basis:
//
// - The company is the Employee ID's: 2MG-… in 2MG Incorporated, GPI-… in Getmeds Philippines
//   Incorporated (made on the company list when it isn't there, its System admin naresh@getmeds.ph).
// - Who is who in 2MG: their Employee ID when it is already on their HR record, else their name (HR
//   writes "Last, First"; the CRM's spellings are kept, a different one is listed to be decided).
// - A GPI employee in 2MG's tree gets the same team and seat in Getmeds (its boxes made there as 2MG
//   has them), and leaves 2MG's (the seat stays, vacant; their history stays in 2MG).
// - Everyone of the sheet not in the tree: added in their company's top box, "To be placed (HR)".
// - Each signs in with their Zoho email as HR lists it (else the company email), whatever its domain
//   (sign-in finds the company that has it), until it is changed; an email two people share stays
//   the first one's.
// - With ALL_PASSWORD: every active person of both companies gets that password, not asked to change
//   it (27 Nov: "the same password for all for now; we change them later"). Never written here.
// - The data checks (Admin panel → Data checks) of each company, before, and after when applied.
//
// --together (27 Nov, the backend developer: "keep both companies connected for now; only what is
// written is tagged to the right company"): everyone stays in 2MG's database, so teams stay whole
// (Vanessa with her Hospital team); each one's employer (2MG or GPI, from the Employee ID) is on their
// HR record, and each order says which company invoices it. Getmeds is still made with its System
// admin, its own database empty of people for now.
// --management=<Employee ID>: that person also gets a seat leading a "Management" box at the top (Ma'am
// Veron, 27 Nov), so the Management desk is theirs.
// HR's sheet may be the .xlsx or a .csv with the same columns.
//
// Check first (the default): it reads and says what it would do; nothing is written. --apply writes.
//
//   On a computer (a trial's folders; see scripts/trial-companies.ts):
//     TRIAL_DIR=<folder> ALL_PASSWORD=<…> npx tsx scripts/align-companies.ts "<HR master data.xlsx>" [--apply]
//   Live (Coolify's API environment: DATABASE_URL, and CONTROL_DATABASE_URL where it is set), only on
//   Aryan's word, after a database backup:
//     ALL_PASSWORD=<…> npx tsx scripts/align-companies.ts "<HR master data.xlsx>" --live [--apply]

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { hashPassword } from "../src/auth/password";
import { runChecks } from "../src/checks/integrity";
import { asCompany } from "../src/companies/context";
import { folderPlaces, openCompanies, postgresPlaces, type Running } from "../src/companies/registry";
import { type Database, rows } from "../src/db/index";
import { migrate } from "../src/db/migrate";
import { updateRecord } from "../src/hr/people";
import { addPerson, addSeat, addUnit, fillSeat, personLeaves, projectOrg } from "../src/org/service";
import { readXlsxBytes } from "../src/reports/xlsx-read";
import type { Me } from "../src/types";

const GETMEDS = { name: "Getmeds Philippines Incorporated", code: "GPI", loginId: "naresh@getmeds.ph", domain: "getmeds.ph" };
const TO_PLACE = "To be placed (HR)";

const apply = process.argv.includes("--apply");
const together = process.argv.includes("--together");
const managementId = process.argv.find((one) => one.startsWith("--management="))?.slice("--management=".length).replace(/\s*-\s*/, "-").toUpperCase() ?? null;
const live = process.argv.includes("--live");
const file = process.argv.slice(2).find((one) => !one.startsWith("--"));
if (!file || !existsSync(file)) throw new Error("Give HR's master data (.xlsx) first.");
const password = process.env.ALL_PASSWORD ?? null;
if (password !== null && password.length < 8) throw new Error("ALL_PASSWORD needs 8 characters or more.");
if (live && !process.env.DATABASE_URL) throw new Error("--live needs DATABASE_URL (the API's, in Coolify).");
if (!live && !process.env.TRIAL_DIR) throw new Error("Give TRIAL_DIR (a trial's folder on this computer), or --live on Aryan's word.");
process.env.COMPANIES = "on";
process.env.CHANNEL_JOBS = "off";

const said: string[] = [];
const toLook: string[] = [];
const say = (line: string) => said.push(`${apply ? "" : "would: "}${line}`);

// ---- The companies, as the server opens them; nothing of the server's own runs (no messages) ----
const places = live ? postgresPlaces(process.env.DATABASE_URL as string) : folderPlaces(join(resolve(process.env.TRIAL_DIR as string), "pg"));
const list = await openCompanies({
  control: await places.control(),
  places,
  home: {
    name: process.env.HOME_COMPANY_NAME ?? "2MG Inc.",
    code: process.env.HOME_COMPANY_CODE ?? "2MG",
    loginDomain: process.env.LOGIN_DOMAIN ?? "2mginc.com",
    loginId: process.env.HOME_COMPANY_LOGIN || undefined,
  },
  ready: async (db) => {
    await migrate(db);
    return { fetch: () => new Response("align-companies", { status: 503 }) };
  },
});
const home = list.home();
console.log(`${live ? "LIVE" : `Trial (${process.env.TRIAL_DIR})`} · ${apply ? "APPLYING" : "checking only (nothing is written)"}${together ? " · together: everyone in 2MG's database" : " · by Employee ID: GPI people into Getmeds"}`);
for (const one of list.all()) console.log(`  company: ${one.ref.name} (${one.ref.code}, Org ID ${one.ref.orgId}, @${one.ref.loginDomain})`);

const checksOf = async (one: Running, when: string) => {
  const result = await runChecks(one.db);
  const bad = result.checks.filter((check) => !check.ok);
  console.log(`  [${one.ref.code}] data checks ${when}: ${bad.length ? `${bad.length} of ${result.checks.length} with problems` : `all ${result.checks.length} fine`}`);
  for (const check of bad) console.log(`      ${check.label}: ${check.count}${check.problems[0] ? ` (e.g. ${check.problems[0]})` : ""}`);
};
console.log("\nThe database now:");
for (const one of list.all()) {
  const [counts] = await rows<{ people: number; seats: number; vacant: number; noPassword: number }>(
    one.db,
    sql`select (select count(*) from person where active)::int as people,
      (select count(*) from seat where active)::int as seats,
      (select count(*) from seat s where s.active and not exists (select 1 from seat_holder h where h.seat_id = s.id and h.kind = 'holder'
        and (h.ends_on is null or h.ends_on >= current_date)))::int as vacant,
      (select count(*) from person where active and password_pending)::int as "noPassword"`,
  );
  console.log(`  [${one.ref.code}] ${counts?.people} people, ${counts?.seats} seats (${counts?.vacant} vacant), ${counts?.noPassword} without a password yet`);
  await checksOf(one, "before");
}

// ---- HR's master data ----
/** `emails`: the Zoho email first (27 Nov: "use their Zoho emails, not the company email"), then the company email. */
type SheetPerson = { id: string; employer: "2mg" | "gpi"; first: string; last: string; name: string; full: string; emails: string[]; zoho: string[] };
/** A CSV line's cells (quotes as Excel writes them). */
const csvCells = (line: string) => {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (quoted && ch === '"' && line[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cell);
      cell = "";
    } else cell += ch;
  }
  out.push(cell);
  return out;
};
const rawRows = file.toLowerCase().endsWith(".csv")
  ? readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).map(csvCells)
  : (readXlsxBytes(new Uint8Array(readFileSync(file)))[0]?.rows ?? []).map((row) => row.cells);
const cells = rawRows.map((row) => row.map((cell) => String(cell ?? "").replace(/\s+/g, " ").trim()));
const headAt = cells.findIndex((row) => row.includes("EMP. ID NO."));
if (headAt < 0) throw new Error("No 'EMP. ID NO.' column in the first sheet.");
const head = cells[headAt] as string[];
const col = (name: string) => head.indexOf(name);
const people: SheetPerson[] = cells
  .slice(headAt + 1)
  .filter((row) => row[col("EMP. ID NO.")] && row[col("EMP. ID NO.")] !== "EMP. ID NO.")
  .map((row) => {
    const id = (row[col("EMP. ID NO.")] as string).replace(/\s*-\s*/, "-").toUpperCase();
    const first = row[col("FIRST NAME")] ?? "";
    const last = row[col("LAST NAME")] ?? "";
    const full = row[col("COMPLETE NAME OF EMPLOYEE")] ?? "";
    // "Last, First M.": its first name too (the FIRST NAME column has "EM" for Melanie).
    const fromFull = full.split(",")[1]?.replace(/\s[A-Z]\.\s*$/, "").trim() ?? "";
    const listed = (cell: string | undefined) =>
      (cell ?? "")
        .split(/[/,;]| or /)
        .map((one) => one.trim().toLowerCase())
        .filter((one) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(one));
    const zoho = listed(row[col("ZOHO EMAIL")]);
    const emails = [...new Set([...zoho, ...listed(row[col("COMPANY EMAIL")])])];
    return { id, employer: id.startsWith("GPI") ? "gpi" : "2mg", first: `${first} ${fromFull}`, last, name: `${first} ${last}`, full, emails, zoho };
  });
console.log(`\nHR's sheet: ${people.length} people (${people.filter((one) => one.employer === "2mg").length} 2MG, ${people.filter((one) => one.employer === "gpi").length} GPI)`);

// ---- Names: the same people, written "Last, First" by HR ----
const words = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z ]/g, " ")
    .split(" ")
    .filter((one) => one.length > 1 && !["ma", "jr", "sr", "ii", "iii"].includes(one));
const like = (a: string, b: string) => {
  if (a === b) return 1;
  let before = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const now = [i];
    for (let j = 1; j <= b.length; j++)
      now[j] = Math.min((before[j] ?? 0) + 1, (now[j - 1] ?? 0) + 1, (before[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    before = now;
  }
  return 1 - (before[b.length] ?? 0) / Math.max(a.length, b.length);
};
const fits = (person: SheetPerson, name: string) => {
  const theirs = words(name);
  const last = words(person.last);
  const first = words(person.first);
  const firsts = [...first, first.join("")];
  const lastFits = last.length > 0 && theirs.some((one) => last.some((part) => like(part, one) >= 0.8));
  const firstFits = first.length > 0 && theirs.some((one) => firsts.some((part) => like(part, one) >= 0.75));
  return (lastFits ? 2 : 0) + (firstFits ? 1 : 0);
};
const sameName = (a: string, b: string) => words(a).join(" ") === words(b).join(" ");

type Known = { id: number; name: string; email: string | null; code: string | null; seated: boolean };
const knownIn = (db: Database) =>
  rows<Known>(
    db,
    sql`select p.id::int as id, p.name, p.email, e.employee_code as code,
        exists (select 1 from seat_holder h join seat s on s.id = h.seat_id and s.active where h.person_id = p.id and s.title <> ${TO_PLACE}
          and (h.ends_on is null or h.ends_on >= current_date)) as seated
      from person p left join employee e on e.person_id = p.id where p.active and p.role <> 'admin'`,
  );

/** Each sheet person to someone already in a company: their Employee ID, else their name (two
 *  passes: first and last name; then the last name alone where only one of each is left). */
function matchUp(sheetPeople: SheetPerson[], known: Known[]) {
  const taken = new Map<number, SheetPerson>();
  const free: SheetPerson[] = [];
  for (const person of sheetPeople) {
    const byCode = known.find((one) => one.code && one.code.replace(/\s/g, "").toUpperCase() === person.id);
    if (byCode && !taken.has(byCode.id)) {
      taken.set(byCode.id, person);
      continue;
    }
    const ranked = known
      .filter((one) => !one.code && !taken.has(one.id))
      .map((one) => ({ one, score: fits(person, one.name) }))
      .filter((one) => one.score >= 3)
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (best && (ranked.length === 1 || (ranked[1]?.score ?? 0) < best.score)) taken.set(best.one.id, person);
    else free.push(person);
  }
  for (const person of [...free]) {
    const lastFits = (name: string) => words(name).some((one) => words(person.last).some((part) => like(part, one) >= 0.8));
    const open = known.filter((one) => !one.code && !taken.has(one.id) && lastFits(one.name));
    const rivals = free.filter((other) => other !== person && sameName(other.last, person.last));
    const only = open[0];
    if (open.length === 1 && only && !rivals.length) {
      taken.set(only.id, person);
      free.splice(free.indexOf(person), 1);
    }
  }
  return { taken, free };
}

// ---- Getmeds: on the list, with its System admin ----
let getmeds = list.all().find((one) => one.ref.code === GETMEDS.code || one.ref.loginDomain === GETMEDS.domain) ?? null;
if (!getmeds) {
  say(`add ${GETMEDS.name} (${GETMEDS.code}, @${GETMEDS.domain}), its System admin ${GETMEDS.loginId}`);
  if (apply) getmeds = (await list.add({ name: GETMEDS.name, code: GETMEDS.code, loginId: GETMEDS.loginId }, null)).company;
} else {
  const [gmAdmin] = await rows<{ email: string }>(getmeds.db, sql`select lower(email) as email from person where role = 'admin' and active order by id limit 1`);
  if (gmAdmin?.email !== GETMEDS.loginId) {
    say(`${getmeds.ref.name}'s login ID ${gmAdmin?.email ?? "(none)"} becomes ${GETMEDS.loginId}`);
    if (apply) await list.change(getmeds.ref.orgId, { loginId: GETMEDS.loginId }, null);
  }
}

const adminOf = async (db: Database): Promise<Me> => {
  const [one] = await rows<{ id: number; name: string }>(db, sql`select id::int as id, name from person where role = 'admin' and active order by id limit 1`);
  if (!one) throw new Error("A company has no System admin working.");
  return { id: one.id, name: one.name, role: "admin", roleLabel: "Admin", email: null, title: null, mustChangePassword: false, channel: null, area: null, reportsTo: null } as Me;
};

// Every login email already somebody's, in either company: one person each.
const used = new Map<string, string>();
for (const one of list.all())
  for (const row of await rows<{ email: string; code: string | null }>(
    one.db,
    sql`select lower(p.email) as email, e.employee_code as code from person p left join employee e on e.person_id = p.id where p.active and p.email is not null`,
  ))
    used.set(row.email, row.code ?? "admin");

/** Their Zoho email as HR lists it (27 Nov: "use their Zoho emails, not the company email"), kept as
 *  it is whatever its domain: of two, the one on their company's domain; with no Zoho email, the
 *  company email; none when it is someone else's already. */
function workEmail(person: SheetPerson, domain: string, current: string | null): string | null {
  const from = person.zoho.length ? person.zoho : person.emails;
  const email = from.find((one) => one.endsWith(`@${domain}`)) ?? from[0] ?? null;
  if (!email || email === current) return null;
  const owner = used.get(email);
  if (owner && owner !== person.id) {
    toLook.push(`${person.id} ${person.name}: ${email} is already someone else's login (${owner}); keeps their own login.`);
    return null;
  }
  used.set(email, person.id);
  return email;
}

const write = async (one: Running, work: () => Promise<void>) => {
  if (apply) await asCompany(one.ref, work);
};

// ---- 2MG's people ----
const homeMe = await adminOf(home.db);
const homeKnown = await knownIn(home.db);
const twoMg = matchUp(people, homeKnown);
for (const [personId, person] of twoMg.taken) {
  const was = homeKnown.find((one) => one.id === personId) as Known;
  if (!sameName(was.name, person.name)) toLook.push(`${person.id}: the CRM says "${was.name}", HR's sheet "${person.full}". Which spelling?`);
  if (person.employer === "gpi" && !together) continue;
  const email = workEmail(person, home.ref.loginDomain, was.email?.toLowerCase() ?? null);
  if (was.code !== person.id) say(`[2MG] ${was.name}: Employee ID ${person.id}, employer ${person.employer.toUpperCase()}`);
  if (email) say(`[2MG] ${was.name}: signs in with ${email}`);
  await write(home, async () => {
    if (was.code !== person.id) await updateRecord(home.db, homeMe, personId, { employeeCode: person.id, company: person.employer });
    if (email) await home.db.execute(sql`update person set email = ${email} where id = ${personId}`);
  });
}
for (const one of homeKnown) if (!twoMg.taken.has(one.id)) toLook.push(`[2MG] ${one.name}${one.code ? ` (${one.code})` : ""}: in the CRM, not in HR's sheet (left as it is).`);

/** Someone of HR's sheet in no company yet: their work email, else a login of their first name, in
 *  the company's top box, for HR to place. */
async function addUnplaced(one: Running, me: Me, person: SheetPerson) {
  const base = (words(person.first)[0] ?? "person").replace(/[^a-z]/g, "");
  let login = workEmail(person, one.ref.loginDomain, null) ?? `${base}@${one.ref.loginDomain}`;
  for (let n = 2; used.has(login) && used.get(login) !== person.id; n++) login = `${base}${n}@${one.ref.loginDomain}`;
  used.set(login, person.id);
  say(`[${one.ref.code}] add ${person.name} (${person.id}), ${TO_PLACE}, signs in with ${login}`);
  await write(one, async () => {
    const [top] = await rows<{ id: number }>(one.db, sql`select id::int as id from org_unit where parent_id is null and active order by id limit 1`);
    const made = await addPerson(one.db, me, { name: person.name, email: login, unitId: top?.id, title: TO_PLACE, module: "staff", employeeCode: person.id });
    await updateRecord(one.db, me, made.personId, { company: person.employer });
  });
}
for (const person of twoMg.free.filter((one) => together || one.employer === "2mg")) await addUnplaced(home, homeMe, person);

// Ma'am Veron's Management desk (27 Nov): a seat leading a "Management" box at the top, as a second seat.
if (managementId) {
  const person = people.find((one) => one.id === managementId);
  const personId = [...twoMg.taken].find(([, one]) => one.id === managementId)?.[0];
  if (!person || !personId) toLook.push(`--management=${managementId}: nobody with that Employee ID in 2MG.`);
  else {
    const [has] = await rows(
      home.db,
      sql`select 1 as one from seat_holder h join seat s on s.id = h.seat_id and s.active where h.person_id = ${personId} and s.module = 'management'
        and (h.ends_on is null or h.ends_on >= current_date)`,
    );
    if (!has) {
      say(`[2MG] ${person.name} (${person.id}): a seat leading "Management", so the Management desk is theirs (their other seat stays)`);
      await write(home, async () => {
        const [top] = await rows<{ id: number }>(home.db, sql`select id::int as id from org_unit where parent_id is null and active order by id limit 1`);
        const [box] = await rows<{ id: number }>(home.db, sql`select id::int as id from org_unit where parent_id = ${top?.id} and active and lower(name) = 'management'`);
        const unitId = box?.id ?? (await addUnit(home.db, homeMe, { name: "Management", kind: "department", parentId: top?.id as number })).unitId;
        const [lead] = await rows<{ id: number }>(home.db, sql`select id::int as id from seat where unit_id = ${unitId} and active and lead`);
        const seatId = lead?.id ?? (await addSeat(home.db, homeMe, { unitId, title: "Operations Management", module: "management", lead: true })).seatId;
        await fillSeat(home.db, homeMe, seatId, { personId, keepOther: true, reason: "Management desk (27 Nov)" });
      });
    }
  }
}

// ---- Getmeds' people (by Employee ID; --together keeps them in 2MG's database) ----
if (getmeds && !together) {
  const gm = getmeds;
  const gmMe = await adminOf(gm.db);
  const gmKnown = await knownIn(gm.db);
  const gpiPeople = people.filter((one) => one.employer === "gpi");
  const inGm = matchUp(gpiPeople, gmKnown);
  for (const [personId, person] of inGm.taken) {
    const was = gmKnown.find((one) => one.id === personId) as Known;
    const email = workEmail(person, gm.ref.loginDomain, was.email?.toLowerCase() ?? null);
    if (was.code !== person.id) say(`[GPI] ${was.name}: Employee ID ${person.id}, employer GPI`);
    if (email) say(`[GPI] ${was.name}: signs in with ${email}`);
    await write(gm, async () => {
      if (was.code !== person.id) await updateRecord(gm.db, gmMe, personId, { employeeCode: person.id, company: "gpi" });
      if (email) await gm.db.execute(sql`update person set email = ${email} where id = ${personId}`);
    });
  }

  // A box of 2MG's tree, made the same in Getmeds (its name, kind and channel, under the same boxes).
  const gmUnits = new Map<number, number>();
  async function gmUnitOf(homeUnitId: number): Promise<number> {
    const had = gmUnits.get(homeUnitId);
    if (had) return had;
    const [unit] = await rows<{ name: string; kind: string; parentId: number | null; channel: string | null }>(
      home.db,
      sql`select u.name, u.kind, u.parent_id::int as "parentId", c.code as channel from org_unit u left join channel c on c.id = u.channel_id where u.id = ${homeUnitId}`,
    );
    if (!unit) throw new Error(`No box ${homeUnitId} on 2MG's tree.`);
    const [top] = await rows<{ id: number }>(gm.db, sql`select id::int as id from org_unit where parent_id is null and active order by id limit 1`);
    if (unit.parentId === null) {
      gmUnits.set(homeUnitId, top?.id as number);
      return top?.id as number;
    }
    const parent = await gmUnitOf(unit.parentId);
    const [same] = await rows<{ id: number }>(gm.db, sql`select id::int as id from org_unit where parent_id = ${parent} and active and lower(name) = lower(${unit.name})`);
    let id = same?.id;
    if (!id) {
      const [channel] = unit.channel ? await rows<{ id: number }>(gm.db, sql`select id::int as id from channel where code = ${unit.channel}`) : [];
      id = (await addUnit(gm.db, gmMe, { name: unit.name, kind: unit.kind as never, parentId: parent, channelId: channel?.id ?? null })).unitId;
    }
    gmUnits.set(homeUnitId, id);
    return id;
  }

  // GPI employees in 2MG's tree, leads first (their boxes are made under them): the same team and
  // seat in Getmeds; their 2MG seats left vacant, their 2MG record marked as left (history kept).
  const gpiIn2mg = [...twoMg.taken].filter(([personId, person]) => person.employer === "gpi" && !gmKnown.some((one) => one.code === person.id) && ![...inGm.taken.values()].includes(person) && homeKnown.find((one) => one.id === personId)?.seated);
  const seatsOf = async (personId: number) =>
    rows<{ unitId: number; title: string; module: string; lead: boolean; area: string | null; cities: string[] | null; open: number }>(
      home.db,
      sql`select s.unit_id::int as "unitId", s.title, s.module, s.lead, a.name as area, a.cities,
          (select count(*) from sales_order o where o.seat_id = s.id and o.status not in ('completed', 'cancelled', 'draft'))::int as open
        from seat_holder h join seat s on s.id = h.seat_id and s.active left join area a on a.id = s.area_id
        where h.person_id = ${personId} and h.kind = 'holder' and (h.ends_on is null or h.ends_on >= current_date)
        order by s.lead desc, h.starts_on, h.id`,
    );
  const withSeats = await Promise.all(gpiIn2mg.map(async ([personId, person]) => ({ personId, person, seats: await seatsOf(personId) })));
  withSeats.sort((a, b) => Number(Boolean(b.seats[0]?.lead)) - Number(Boolean(a.seats[0]?.lead)));
  for (const { personId, person, seats } of withSeats) {
    const was = homeKnown.find((one) => one.id === personId) as Known;
    const first = seats[0];
    if (!first) continue;
    const email = workEmail(person, gm.ref.loginDomain, null);
    const open = seats.reduce((sum, seat) => sum + seat.open, 0);
    say(`[GPI] ${was.name} (${person.id}): "${first.title}" copied into Getmeds${email ? `, signs in with ${email}` : ""}; leaves 2MG (seat vacant${open ? `, ${open} open orders stay with it` : ""})`);
    for (const other of seats.slice(1)) toLook.push(`${person.id} ${was.name}: also holds "${other.title}" at 2MG; only their first seat is copied.`);
    await write(gm, async () => {
      const unitId = await gmUnitOf(first.unitId);
      const [leadHere] = first.lead ? await rows(gm.db, sql`select 1 as one from seat where unit_id = ${unitId} and active and lead`) : [];
      const lead = first.lead && !leadHere;
      const areaTaken = first.area ? (await rows(gm.db, sql`select 1 as one from area where lower(name) = lower(${first.area})`)).length > 0 : false;
      const made = await addPerson(gm.db, gmMe, {
        name: was.name,
        email,
        unitId,
        title: first.title,
        module: (lead ? first.module : first.module === "team_lead" || first.module === "manager" ? "medrep" : first.module) as never,
        lead,
        ...(first.area && !areaTaken ? { newArea: { name: first.area, cities: first.cities ?? [] } } : {}),
        employeeCode: person.id,
      });
      await updateRecord(gm.db, gmMe, made.personId, { company: "gpi" });
      if (first.lead && !lead) toLook.push(`${person.id} ${was.name}: led their 2MG team; Getmeds' copy has its lead already, so placed in it.`);
    });
    await write(home, async () => {
      await personLeaves(home.db, homeMe, personId, { reason: `Employed by ${GETMEDS.name} (${person.id}): works in Getmeds' own database` });
    });
  }
  const placedGpi = new Set([...inGm.taken.values(), ...withSeats.map((one) => one.person)]);
  for (const person of gpiPeople.filter((one) => !placedGpi.has(one) && !gmKnown.some((known) => known.code === one.id))) await addUnplaced(gm, gmMe, person);
  for (const one of gmKnown) if (!inGm.taken.has(one.id)) toLook.push(`[GPI] ${one.name}${one.code ? ` (${one.code})` : ""}: in Getmeds, not in HR's sheet (left as it is).`);
} else if (!together) toLook.push(`${GETMEDS.name} isn't on the list yet: its people are added when this is applied.`);

// ---- One password for everyone, for now ----
if (password !== null) {
  const hash = await hashPassword(password);
  for (const one of list.all()) {
    const [counted] = await rows<{ n: number }>(one.db, sql`select count(*)::int as n from person where active`);
    say(`[${one.ref.code}] the same password for all ${counted?.n} active people, not asked to change it`);
    await write(one, async () => {
      await one.db.execute(sql`update person set password_hash = ${hash}, password_pending = false, must_change_password = false where active`);
    });
  }
} else toLook.push("No ALL_PASSWORD: passwords left as they are.");

if (apply)
  for (const one of list.all()) {
    await asCompany(one.ref, () => projectOrg(one.db));
  }

console.log(`\n${apply ? "Done" : "It would do"} (${said.length}):`);
for (const line of said) console.log(`  ${line}`);
console.log(`\nTo look at (${toLook.length}):`);
for (const line of toLook) console.log(`  ${line}`);
if (apply) {
  console.log("\nAfter:");
  for (const one of list.all()) await checksOf(one, "after");
}
process.exit(0);
