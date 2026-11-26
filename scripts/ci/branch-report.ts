// The branch report, in plain English for everyone on the team (26 Nov): on every push it says
// what the branch changes compared with main, what could break main if it were merged, and which
// other branches are changing the same things. It only reports (it never fails the run); the
// checks themselves (ci.yml) decide pass or fail.
//
//   node scripts/ci/branch-report.ts                     → the report for the branch checked out (HEAD)
//   node scripts/ci/branch-report.ts --head origin/hr    → the report for another branch
//
// Reads origin/main and every origin/* branch, so the workflow fetches them all first.

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

/** Each part of the system in words, by its files (the first rule that matches). */
const AREAS: [RegExp, string][] = [
  [/^apps\/api\/migrations\//, "Database changes (migrations)"],
  [/^apps\/api\/src\/(auth|account)\/|^apps\/api\/src\/(http|app)\.ts$|^apps\/web\/src\/(account|desk)\//, "Sign-in, sessions and security"],
  [/^apps\/api\/src\/(finance|books|returns)\/|^apps\/web\/src\/(finance|books)\//, "Finance, invoices and the books"],
  [/^apps\/api\/src\/companies\.ts$/, "The company list (2MG, GPI)"],
  [/^apps\/api\/src\/(orders|dispatch|inventory|purchases)\/|^apps\/web\/src\/(orders|dispatch|inventory|buying)\//, "Orders, dispatch and stock"],
  [/^apps\/api\/src\/hr\/|^apps\/web\/src\/hr\//, "HR, attendance and payroll"],
  [/^apps\/api\/src\/(mr|field|customers|sellers|team|org|targets|scores|kpis|sales)\/|^apps\/web\/src\/(mr|customers|sellers|team|org|field)\//, "Sales teams, customers and the field"],
  [/^apps\/api\/src\/(tenders)\/|^workers\/tender-finder\//, "Tenders and the tender robot"],
  [/^apps\/api\/src\/(online|points|b2c|messages|notify)\/|^apps\/web\/src\/(online|messages)\//, "Online desk, messages and alerts"],
  [/^apps\/web\/src\/(menus|shell)\.tsx?$/, "Menus and the app's frame"],
  [/^apps\/api\/src\/types\.ts$/, "Shared data shapes (API and web)"],
  [/(^|\/)package\.json$|^pnpm-lock\.yaml$|^pnpm-workspace\.yaml$/, "Packages and the libraries the system uses"],
  [/^apps\/api\//, "Other API code"],
  [/^apps\/web\//, "Other screens"],
  [/^\.github\/|^scripts\/ci\//, "The automatic checks (CI)"],
  [/(^|\/)Dockerfile$|^docker-compose|^apps\/web\/docker\/|^deploy\//, "How it is built and deployed"],
  [/^docs\/|\.md$/i, "Documents"],
];

export const areaOf = (file: string): string => AREAS.find(([rule]) => rule.test(file))?.[1] ?? "Other files";

/** Changed files grouped by area, the largest first. */
export function byArea(files: string[]): { area: string; files: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const file of files) groups.set(areaOf(file), [...(groups.get(areaOf(file)) ?? []), file]);
  return [...groups].map(([area, list]) => ({ area, files: list })).sort((a, b) => b.files.length - a.files.length);
}

/** A migration's number: "0159_company_codes.sql" → 159. */
const numberOf = (file: string) => Number(/(\d{4})_[^/]*\.sql$/.exec(file)?.[1] ?? Number.NaN);
const isMigration = (file: string) => /^apps\/api\/migrations\/\d{4}_.*\.sql$/.test(file);

/** Migrations a branch adds that clash with main's: a number main already uses, or one not after main's last. */
export function migrationProblems(added: string[], onMain: string[]): string[] {
  const mainNumbers = new Map(onMain.filter(isMigration).map((file) => [numberOf(file), file]));
  const last = Math.max(0, ...mainNumbers.keys());
  const problems: string[] = [];
  for (const file of added.filter(isMigration)) {
    const n = numberOf(file);
    const same = mainNumbers.get(n);
    if (same && same !== file) problems.push(`${name(file)} uses number ${n}, which main already has (${name(same)}): renumber it after ${String(last).padStart(4, "0")}.`);
    else if (!same && n <= last) problems.push(`${name(file)} comes before main's last migration (${String(last).padStart(4, "0")}): it would run out of order; renumber it after it.`);
  }
  return problems;
}

/** What deserves a careful look before merging, in words, from the changed files (A added, M changed, D deleted). */
export function risks(changes: { status: string; file: string }[]): string[] {
  const out: string[] = [];
  const has = (rule: RegExp) => changes.some((one) => rule.test(one.file));
  if (has(/^apps\/api\/migrations\//))
    out.push("It changes the database: its migrations run on the live database when main is deployed. Check them on a copy first.");
  if (has(/^apps\/api\/src\/(auth|account)\/|^apps\/api\/src\/(http|app)\.ts$/))
    out.push("It touches sign-in, sessions or the API's door: who can get in and what they may do.");
  if (has(/^apps\/api\/src\/(finance|books|returns)\/|^apps\/api\/src\/companies\.ts$/))
    out.push("It touches money: invoices, payments, refunds or the books.");
  if (has(/(^|\/)package\.json$|^pnpm-lock\.yaml$/)) out.push("It changes a package's setup or the libraries the system uses.");
  if (has(/(^|\/)Dockerfile$|^docker-compose|^deploy\//)) out.push("It changes how the system is built or deployed.");
  if (has(/^\.github\//)) out.push("It changes the automatic checks themselves.");
  const deleted = changes.filter((one) => one.status === "D");
  if (deleted.length) out.push(`It deletes ${deleted.length} file${deleted.length === 1 ? "" : "s"} (${deleted.slice(0, 5).map((one) => name(one.file)).join(", ")}${deleted.length > 5 ? "…" : ""}).`);
  return out;
}

const name = (file: string) => file.split("/").pop() ?? file;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---- Reading git

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}
const lines = (text: string) => text.split("\n").map((one) => one.trim()).filter(Boolean);

/** The files two commits would conflict on if merged (git merge-tree, nothing written). */
function conflicts(a: string, b: string): string[] {
  const run = spawnSync("git", ["merge-tree", "--write-tree", "--name-only", "--no-messages", a, b], { encoding: "utf8" });
  if (run.status === 0) return [];
  if (run.status !== 1) return ["(git could not compare them)"];
  return lines(run.stdout).slice(1);
}

function changedSince(base: string, head: string): { status: string; file: string }[] {
  return lines(git("diff", "--name-status", "--no-renames", `${base}...${head}`)).map((row) => {
    const [status = "M", file = ""] = row.split(/\t/);
    return { status: status[0] ?? "M", file };
  });
}

function report(asked?: string): string {
  const main = "origin/main";
  const head = asked ?? "HEAD";
  const branch = asked ? asked.replace(/^origin\//, "") : process.env.GITHUB_REF_NAME || git("rev-parse", "--abbrev-ref", "HEAD");
  const out: string[] = [`## Branch report: ${branch}`, ""];
  const mainFiles = lines(git("ls-tree", "-r", "--name-only", main, "--", "apps/api/migrations"));
  const onMain = branch === "main";

  if (!onMain) {
    const [behind = 0, ahead = 0] = git("rev-list", "--left-right", "--count", `${main}...${head}`).split(/\s+/).map(Number);
    const changes = changedSince(main, head);
    out.push("### What this branch changes, compared with main", "");
    if (!ahead) out.push("Nothing: everything on this branch is already in main.", "");
    else {
      out.push(`${plural(ahead, "change")} (commits) not in main yet, touching ${plural(changes.length, "file")}:`, "");
      for (const group of byArea(changes.map((one) => one.file)))
        out.push(`- **${group.area}**: ${group.files.slice(0, 6).map(name).join(", ")}${group.files.length > 6 ? ` and ${group.files.length - 6} more` : ""}`);
      out.push("");
      out.push("The last changes:", "");
      for (const row of lines(git("log", "--format=%s", "-8", `${main}..${head}`))) out.push(`- ${row}`);
      out.push("");
    }

    out.push("### What could break main if this is merged", "");
    const problems: string[] = [];
    const clash = conflicts(main, head);
    if (clash.length) problems.push(`It conflicts with main in ${plural(clash.length, "file")} (${clash.slice(0, 6).map(name).join(", ")}): bring main into this branch and settle them first.`);
    if (behind) problems.push(`Main has ${plural(behind, "change")} this branch hasn't got yet: bring main in before merging, so it is checked against the latest main.`);
    problems.push(...migrationProblems(changes.filter((one) => one.status === "A").map((one) => one.file), mainFiles));
    const careful = risks(changes);
    if (!problems.length && !careful.length) out.push("Nothing found: no conflict with main, it is up to date, and it touches nothing risky.");
    for (const one of problems) out.push(`- ⚠️ ${one}`);
    for (const one of careful) out.push(`- 👀 ${one}`);
    if (!problems.length && careful.length) out.push("", "No conflict with main and it is up to date; the 👀 points only need a careful look.");
    out.push("");
    for (const one of problems) console.log(`::warning title=Could break main::${one}`);
  }

  // Every other branch with changes main hasn't got: what it changes, and where it meets this one.
  const mine = onMain ? [] : changedSince(main, head).map((one) => one.file);
  const others = lines(git("for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"))
    .filter((ref) => ref !== main && ref !== "origin/HEAD" && ref !== "origin" && ref !== `origin/${branch}`);
  out.push(onMain ? "### Branches waiting to come into main" : "### Other branches at work", "");
  let listed = 0;
  for (const ref of others) {
    const [behind = 0, ahead = 0] = git("rev-list", "--left-right", "--count", `${main}...${ref}`).split(/\s+/).map(Number);
    if (!ahead) continue;
    listed++;
    const theirs = changedSince(main, ref);
    const areas = byArea(theirs.map((one) => one.file)).map((group) => group.area);
    const words = [`**${ref.replace("origin/", "")}**: ${plural(ahead, "change")} not in main (${areas.slice(0, 4).join(", ")}${areas.length > 4 ? "…" : ""})${behind ? `, ${behind} behind main` : ""}.`];
    const withMain = conflicts(main, ref);
    if (withMain.length) words.push(`Conflicts with main in ${withMain.slice(0, 4).map(name).join(", ")}.`);
    if (!onMain) {
      const shared = theirs.map((one) => one.file).filter((file) => mine.includes(file));
      if (shared.length) {
        const withMe = conflicts(head, ref);
        words.push(
          withMe.length
            ? `⚠️ Changes the same files as this branch and **would conflict** with it in ${withMe.slice(0, 4).map(name).join(", ")}: agree who goes first.`
            : `Changes ${plural(shared.length, "file")} this branch changes too (${shared.slice(0, 4).map(name).join(", ")}), without conflicting.`,
        );
      }
      const theirMigrations = theirs.filter((one) => one.status === "A" && isMigration(one.file)).map((one) => one.file);
      const myMigrations = changedSince(main, head).filter((one) => one.status === "A" && isMigration(one.file)).map((one) => one.file);
      for (const file of myMigrations)
        for (const other of theirMigrations)
          if (numberOf(file) === numberOf(other) && file !== other)
            words.push(`⚠️ Both add migration number ${numberOf(file)} (${name(file)} here, ${name(other)} there): one must take the next number.`);
    }
    out.push(`- ${words.join(" ")}`);
  }
  if (!listed) out.push("None: no other branch has changes main hasn't got.");
  out.push("");
  return out.join("\n");
}

if (import.meta.main) {
  const at = process.argv.indexOf("--head");
  const text = report(at > 0 ? process.argv[at + 1] : undefined);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}
