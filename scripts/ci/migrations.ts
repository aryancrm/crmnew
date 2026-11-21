// The migrations' own rules, checked on every run: each is applied once, in name order, on start
// (apps/api/src/db/migrate.ts), so a name may not repeat its number, a new one must come after every
// one already there, and one already in main is never edited or removed: add a new one instead.
//
//   node scripts/ci/migrations.ts [<base-sha>]

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const DIR = "apps/api/migrations";
const NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

export function migrationProblems(names: string[], before: string[] = [], changed: { status: string; file: string }[] = []): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const name of names) {
    const number = NAME.exec(name)?.[1];
    if (!number) {
      problems.push(`${name}: name it NNNN_words.sql (four digits, lower case, underscores).`);
      continue;
    }
    const other = seen.get(number);
    if (other) problems.push(`${name} and ${other} share the number ${number}: renumber the new one.`);
    seen.set(number, name);
  }
  const last = [...before].sort().at(-1);
  for (const name of names) if (last && !before.includes(name) && name < last) problems.push(`${name} comes before ${last}, already in main: give it a later number.`);
  for (const one of changed)
    if (!one.status.startsWith("A"))
      problems.push(`${one.file} is already in main and was ${one.status.startsWith("D") ? "removed" : "changed"}: add a new migration instead.`);
  return problems;
}

if (import.meta.main) {
  const base = process.argv[2];
  const names = readdirSync(DIR).filter((name) => name.endsWith(".sql")).sort();
  let before: string[] = [];
  let changed: { status: string; file: string }[] = [];
  if (base && !/^0+$/.test(base)) {
    const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });
    before = git("ls-tree", "--name-only", `${base}`, `${DIR}/`).split("\n").filter(Boolean).map((path) => path.split("/").at(-1) as string);
    changed = git("diff", "--name-status", `${base}...HEAD`, "--", DIR)
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [status, file] = line.split("\t");
        return { status: status as string, file: file as string };
      });
  }
  const problems = migrationProblems(names, before, changed);
  if (problems.length) {
    for (const problem of problems) console.error(`✖ ${problem}`);
    process.exit(1);
  }
  console.log(`✓ ${names.length} migrations in order${base ? `; ${changed.length} new since the base` : ""}.`);
}
