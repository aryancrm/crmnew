// Every seat's login ID, listed for Aryan to hand out (docs/LOGINS-LIVE.md): team, name, job, ID.
//
//   npx tsx scripts/list-logins.ts --live          (the live CRM, read only)
//   TEST_PGLITE_DIR=<a local database> npx tsx scripts/list-logins.ts --out=<file>

import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { rows } from "../src/db/index";
import { openTarget } from "./zoho-files";

if (!process.env.TEST_PGLITE_DIR && !process.argv.includes("--live")) {
  console.log("Give TEST_PGLITE_DIR (a local database), or --live.");
  process.exit(1);
}
const target = await openTarget(false);
if (!target) process.exit(1);
const { db } = target;
const out = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6) ?? "../../docs/LOGINS-LIVE.md";
const units = await rows<{ id: number; parentId: number | null; name: string }>(db, sql`select id::int as id, parent_id::int as "parentId", name from org_unit where active`);
const byId = new Map(units.map((u) => [u.id, u]));
const pathOf = (id: number) => {
  const names: string[] = [];
  for (let at = byId.get(id); at?.parentId; at = byId.get(at.parentId)) names.unshift(at.name);
  return names.join(" › ") || "2MG Inc.";
};
const seats = await rows<{ unitId: number; lead: boolean; name: string | null; title: string; login: string | null }>(
  db,
  sql`select s.unit_id::int as "unitId", s.lead, s.title, s.login,
      (select p.name from seat_holder h join person p on p.id = h.person_id and p.active where h.seat_id = s.id and h.ends_on is null limit 1) as name
    from seat s where s.active`,
);
const list = seats
  .map((seat) => ({ ...seat, path: pathOf(seat.unitId) }))
  .sort((a, b) => (a.path === "2MG Inc." ? -1 : b.path === "2MG Inc." ? 1 : a.path.localeCompare(b.path)) || Number(b.lead) - Number(a.lead) || (a.login ?? "").localeCompare(b.login ?? "", "en", { numeric: true }));
const lines = [
  "# Live CRM: who signs in with which ID",
  "",
  "Open https://one.bishnoi.ai, type the **Login ID** below and your own password (the first time, the one-time one the administrator gave you).",
  "",
  "| Team | Name | Job | Login ID |",
  "|---|---|---|---|",
  ...list.map((row) => `| ${row.path} | ${row.name ?? "(vacant)"} | ${row.title} | ${row.login ?? ""} |`),
  "",
];
writeFileSync(out, lines.join("\n"));
console.log("listed", list.length, "seats,", list.filter((row) => row.name).length, "people");
process.exit(0);
