// The two companies on a computer, for a trial before live (27 Nov 2026, the backend developer: "set it
// up properly on the computer for the trial"; HR's master data "HR Dashboard Project - UPDATED.xlsx"
// and the 2026 chart). Two steps, with the chart's own scripts between them:
//
//   1. init  — the company list and 2MG Incorporated (the server's own database), its System admin
//              info@2mginc.com.
//   2. (the chart, as live got it: onboard-company, fix-chart-17nov, claire-back-19nov,
//       load-target-sheet, align-org-to-sheet, each with TEST_PGLITE_DIR=<dir>/pg --apply)
//   3. sheet <file.xlsx> — HR's master data onto 2MG's people (their name as HR writes it, Employee ID,
//              employer 2MG or GPI by the ID, their login email where it is on 2MG's domain), the
//              sheet's people not on the chart added on a login of their first name, and Getmeds
//              Philippines Incorporated added (its System admin naresh@getmeds.ph) with its own
//              people from the sheet (GPI IDs not on the chart). Prints what it did and what is left.
//
// Who goes where (27 Nov, "B, the safe route"): by the work on the chart, so 2MG's teams stay whole;
// the employer stays on each HR record (Company, from the Employee ID). The two System admins get the
// password given in ADMIN_PASSWORD (never written here), without being asked to change it; everyone
// else has none until scripts/give-passwords.ts gives each a one-time one.
//
// Never the live database: a folder of its own (TRIAL_DIR, e.g. ../../.data/trial). Safe to run again.
//
//   TRIAL_DIR=<folder> ADMIN_PASSWORD=<…> npx tsx scripts/trial-companies.ts init
//   TRIAL_DIR=<folder> ADMIN_PASSWORD=<…> npx tsx scripts/trial-companies.ts sheet "<HR master data.xlsx>"
//   (then claire-back-19nov and align-org-to-sheet again, for the people the sheet brought back)
//   TRIAL_DIR=<folder> ADMIN_PASSWORD=<…> npx tsx scripts/trial-companies.ts tidy

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { createApp } from "../src/app";
import { hashPassword } from "../src/auth/password";
import { asCompany } from "../src/companies/context";
import { folderPlaces, openCompanies } from "../src/companies/registry";
import { readyCompany } from "../src/companies/start";
import { type Database, rows } from "../src/db/index";
import { updateRecord } from "../src/hr/people";
import { addPerson } from "../src/org/service";
import { readXlsxBytes } from "../src/reports/xlsx-read";
import type { Me } from "../src/types";

const HOME = { name: "2MG Incorporated", code: "2MG", loginDomain: "2mginc.com", loginId: "info@2mginc.com" };
const GETMEDS = { name: "Getmeds Philippines Incorporated", code: "GPI", loginId: "naresh@getmeds.ph" };

if (process.argv.includes("--live")) throw new Error("This is for a trial on a computer only, never the live database.");
const dir = process.env.TRIAL_DIR;
if (!dir) throw new Error("Give TRIAL_DIR: a folder of its own for the trial (e.g. ../../.data/trial).");
const password = process.env.ADMIN_PASSWORD;
if (!password || password.length < 8) throw new Error("Give ADMIN_PASSWORD (8 characters or more) for the two System admins.");
const step = process.argv[2];
const mainDir = join(resolve(dir), "pg");

process.env.COMPANIES = "on";
process.env.CHANNEL_JOBS = "off";
process.env.ADMIN_EMAIL = HOME.loginId;
process.env.ADMIN_PASSWORD = password;

const places = folderPlaces(mainDir);
const list = await openCompanies({
  control: await places.control(),
  places,
  home: HOME,
  ready: (db, ref) =>
    asCompany(ref, async () => {
      await readyCompany(db, { home: ref.home, embedded: true, label: ref.code });
      return createApp(db, { webUrl: "http://localhost:5181" });
    }),
});
const home = list.all().find((one) => one.ref.home);
if (!home) throw new Error("2MG isn't on the list.");

/** The System admin opens with the password given, not asked to change it (both admins, 27 Nov). */
async function adminPassword(db: Database, login: string, name?: string) {
  const hash = await hashPassword(password as string);
  await db.execute(
    sql`update person set password_hash = ${hash}, must_change_password = false, password_pending = false
      ${name ? sql`, name = ${name}` : sql``}
      where lower(email) = ${login} and role = 'admin'`,
  );
}

if (step === "init") {
  await adminPassword(home.db, HOME.loginId);
  const [admin] = await rows<{ n: number }>(home.db, sql`select count(*)::int as n from person where lower(email) = ${HOME.loginId}`);
  console.log(`${home.ref.name} (Org ID ${home.ref.orgId}, @${home.ref.loginDomain}): System admin ${HOME.loginId} ${admin?.n ? "ready" : "MISSING"}.`);
  console.log(`Next: the chart's scripts with TEST_PGLITE_DIR=${mainDir} --apply, then: trial-companies.ts sheet <file.xlsx>`);
  process.exit(0);
}
// After the chart's own scripts placed someone the sheet brought back (Claire Gallana: in HR's sheet,
// not on the chart; claire-back-19nov and align-org-to-sheet give her the target sheet's seats): their
// "To be placed" seat ends and closes.
if (step === "tidy") {
  for (const one of list.all()) {
    const placed = await rows<{ holding: number; seat: number; name: string }>(
      one.db,
      sql`select h.id::int as holding, s.id::int as seat, p.name from seat_holder h join seat s on s.id = h.seat_id and s.active
        join person p on p.id = h.person_id
        where s.title = 'To be placed (HR)' and (h.ends_on is null or h.ends_on >= current_date)
          and exists (select 1 from seat_holder o join seat os on os.id = o.seat_id and os.active
            where o.person_id = h.person_id and o.id <> h.id and os.title <> 'To be placed (HR)' and (o.ends_on is null or o.ends_on >= current_date))`,
    );
    for (const row of placed) {
      await one.db.execute(sql`update seat_holder set ends_on = current_date - 1, end_reason = 'Placed on the chart' where id = ${row.holding}`);
      await one.db.execute(sql`update seat set active = false, closed_at = now() where id = ${row.seat}`);
      console.log(`[${one.ref.code}] ${row.name}: placed on the chart; the "To be placed" seat closed.`);
    }
  }
  process.exit(0);
}
if (step !== "sheet") throw new Error("Say the step: init, sheet <file.xlsx>, or tidy.");

// ---- HR's master data ----
const file = process.argv[3];
if (!file || !existsSync(file)) throw new Error("Give the HR master data's .xlsx file after 'sheet'.");
type SheetPerson = { id: string; employer: "2mg" | "gpi"; first: string; last: string; name: string; full: string; emails: string[] };
const [sheet] = readXlsxBytes(new Uint8Array(readFileSync(file)));
const cells = (sheet?.rows ?? []).map((row) => row.cells.map((cell) => String(cell ?? "").replace(/\s+/g, " ").trim()));
const headAt = cells.findIndex((row) => row.includes("EMP. ID NO."));
if (headAt < 0) throw new Error("No 'EMP. ID NO.' column in the first sheet.");
const head = cells[headAt] as string[];
const col = (name: string) => head.indexOf(name);
const people: SheetPerson[] = cells
  .slice(headAt + 1)
  .filter((row) => row[col("EMP. ID NO.")] && row[col("EMP. ID NO.")] !== "EMP. ID NO.")
  .map((row) => {
    const id = (row[col("EMP. ID NO.")] as string).replace(/\s*-\s*/, "-");
    const first = row[col("FIRST NAME")] ?? "";
    const last = row[col("LAST NAME")] ?? "";
    const emails = [row[col("COMPANY EMAIL")], row[col("ZOHO EMAIL")]]
      .flatMap((one) => (one ?? "").split(/[\/,;]| or /))
      .map((one) => one.trim().toLowerCase())
      .filter((one) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(one));
    // "Last, First M." as HR writes the full name: its first name too (the FIRST NAME column has "EM"
    // for Melanie, "Atonette" for Antonette).
    const full = row[col("COMPLETE NAME OF EMPLOYEE")] ?? "";
    const fromFull = full.split(",")[1]?.replace(/\s[A-Z]\.\s*$/, "").trim() ?? "";
    return { id, employer: id.startsWith("GPI") ? "gpi" : "2mg", first: `${first} ${fromFull}`, last, name: `${first} ${last}`, full, emails: [...new Set(emails)] };
  });

// ---- Who on 2MG's chart each one is: the names are the same people, written "Last, First" by HR ----
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
  const lastFits = last.length > 0 && theirs.some((one) => last.some((part) => like(part, one) >= 0.8));
  // "Andrea Lyn" and "Andrealyn": the first name's words joined count too.
  const firsts = [...first, first.join("")];
  const firstFits = first.length > 0 && theirs.some((one) => firsts.some((part) => like(part, one) >= 0.75));
  return (lastFits ? 2 : 0) + (firstFits ? 1 : 0);
};

const admin = (db: Database, row: { id: number; name: string }): Me =>
  ({ id: row.id, name: row.name, role: "admin", roleLabel: "Admin", email: null, title: null, mustChangePassword: false, channel: null, area: null, reportsTo: null }) as Me;

const done: string[] = [];
const left: string[] = [];

/** Puts HR's facts on one person of a company: the name as HR writes it, the Employee ID, the
 *  employer, and their login email when it is on this company's domain and nobody else's. */
async function apply(db: Database, me: Me, domain: string, personId: number, person: SheetPerson, was: string) {
  // The name stays as the CRM has it (the sheet has its own slips, "Atonette"); a different spelling
  // is listed to be decided.
  if (words(was).join(" ") !== words(person.name).join(" ")) left.push(`${person.id}: the CRM says "${was}", HR's sheet "${person.full}". Which spelling?`);
  await updateRecord(db, me, personId, { employeeCode: person.id, company: person.employer });
  const email = person.emails.find((one) => one.endsWith(`@${domain}`));
  if (email) {
    const [taken] = await rows<{ id: number }>(db, sql`select id::int as id from person where lower(email) = ${email} and id <> ${personId}`);
    if (taken) left.push(`${person.id} ${person.name}: ${email} is someone else's here; signs in with their seat's login.`);
    else await db.execute(sql`update person set email = ${email} where id = ${personId}`);
  }
  done.push(`${person.id} ${was}${email ? ` · ${email}` : " · seat login"}`);
}

/** Someone of HR's sheet with no place on the chart: a login of their first name, in the company's
 *  top box, for HR to place (27 Nov: "make them an account on their first name for now"). */
async function addUnplaced(db: Database, me: Me, domain: string, person: SheetPerson) {
  const [already] = await rows<{ id: number }>(
    db,
    sql`select p.id::int as id from person p join employee e on e.person_id = p.id where e.employee_code = ${person.id}`,
  );
  if (already) return;
  const [top] = await rows<{ id: number }>(db, sql`select id::int as id from org_unit where parent_id is null and active order by id limit 1`);
  const base = (words(person.first)[0] ?? "person").replace(/[^a-z]/g, "");
  let login = person.emails.find((one) => one.endsWith(`@${domain}`)) ?? `${base}@${domain}`;
  for (let n = 2; (await rows(db, sql`select 1 from person where lower(email) = ${login}`)).length; n++) login = `${base}${n}@${domain}`;
  const made = await addPerson(db, me, {
    name: person.name,
    email: login,
    unitId: top?.id,
    title: "To be placed (HR)",
    module: "staff",
    employeeCode: person.id,
  });
  await db.execute(sql`update person set password_pending = true where id = ${made.personId}`);
  await updateRecord(db, me, made.personId, { company: person.employer });
  done.push(`${person.id} ${person.name} · added, not on the chart · ${login}`);
}

// ---- 2MG: the chart's people ----
const [homeAdmin] = await rows<{ id: number; name: string }>(home.db, sql`select id::int as id, name from person where lower(email) = ${HOME.loginId}`);
if (!homeAdmin) throw new Error(`2MG's System admin ${HOME.loginId} isn't there: run init first.`);
const chart = await rows<{ id: number; name: string }>(
  home.db,
  sql`select p.id::int as id, p.name from person p where p.active and p.role <> 'admin'
    and exists (select 1 from seat_holder h where h.person_id = p.id)`,
);
if (!chart.length) throw new Error("2MG has nobody on its chart yet: run the chart's scripts first.");
const taken = new Map<number, SheetPerson>();
const notOnChart: SheetPerson[] = [];
for (const person of people) {
  const ranked = chart
    .map((one) => ({ one, score: fits(person, one.name) }))
    .filter((one) => one.score >= 3 && !taken.has(one.one.id))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (best && (ranked.length === 1 || (ranked[1]?.score ?? 0) < best.score)) taken.set(best.one.id, person);
  else notOnChart.push(person);
}
// Second look, by the last name alone where only one of each is left on both sides (Malou and
// Marilou Jagonoy: the same person under her short name).
for (const person of [...notOnChart]) {
  const lastFits = (name: string) => words(name).some((one) => words(person.last).some((part) => like(part, one) >= 0.8));
  const open = chart.filter((one) => !taken.has(one.id) && lastFits(one.name));
  const rivals = notOnChart.filter((other) => other !== person && words(other.last).join(" ") === words(person.last).join(" "));
  const only = open[0];
  if (open.length === 1 && only && !rivals.length) {
    taken.set(only.id, person);
    notOnChart.splice(notOnChart.indexOf(person), 1);
  }
}
await asCompany(home.ref, async () => {
  const me = admin(home.db, homeAdmin);
  for (const [personId, person] of taken) {
    const was = chart.find((one) => one.id === personId)?.name ?? "";
    await apply(home.db, me, home.ref.loginDomain, personId, person, was);
  }
  for (const person of notOnChart.filter((one) => one.employer === "2mg")) await addUnplaced(home.db, me, home.ref.loginDomain, person);
});
for (const one of chart) if (!taken.has(one.id)) left.push(`${one.name}: on the chart, not in HR's sheet (kept for now; their official account later).`);

// ---- Getmeds Philippines Incorporated: its own database, its own people ----
let getmeds = list.all().find((one) => one.ref.code === GETMEDS.code);
if (!getmeds) {
  const made = await list.add({ name: GETMEDS.name, code: GETMEDS.code, loginId: GETMEDS.loginId }, null);
  getmeds = made.company;
}
await adminPassword(getmeds.db, GETMEDS.loginId, "Naresh Bishnoi");
const [gmAdmin] = await rows<{ id: number; name: string }>(getmeds.db, sql`select id::int as id, name from person where lower(email) = ${GETMEDS.loginId}`);
await asCompany(getmeds.ref, async () => {
  const me = admin(getmeds.db, gmAdmin as { id: number; name: string });
  for (const person of notOnChart.filter((one) => one.employer === "gpi")) await addUnplaced(getmeds.db, me, getmeds.ref.loginDomain, person);
});

console.log(`\n${home.ref.name} (Org ID ${home.ref.orgId}, @${home.ref.loginDomain}) · System admin ${HOME.loginId}`);
console.log(`${getmeds.ref.name} (Org ID ${getmeds.ref.orgId}, @${getmeds.ref.loginDomain}) · System admin ${GETMEDS.loginId}`);
console.log(`\nDone (${done.length}):`);
for (const line of done) console.log(`  ${line}`);
console.log(`\nTo look at (${left.length}):`);
for (const line of left) console.log(`  ${line}`);
process.exit(0);
