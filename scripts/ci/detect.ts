// Which checks a change needs (Aryan, 21 Nov: "detect the files first, to align which tests to run
// and which not"). Reads the changed files (and what was added in them), and answers with the
// groups to switch on. A file no rule knows switches everything on, so nothing slips through.
//
//   node scripts/ci/detect.ts <base-sha>      → JSON on stdout, and GITHUB_OUTPUT when in Actions
//   node scripts/ci/detect.ts --all           → everything (main, nightly, by hand)

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

export type Groups = {
  /** Every run: secrets, migration numbers. */
  always: true;
  web: boolean;
  /** Sign-in, PIN and desk screens: their browser tests (when they exist). */
  webAuth: boolean;
  api: boolean;
  /** Every API test, not only the related ones. */
  apiAll: boolean;
  /** The changed API files, for `vitest related` (empty when apiAll). */
  apiRelated: string[];
  security: boolean;
  rawSql: boolean;
  database: boolean;
  deps: boolean;
  docker: boolean;
  config: boolean;
  scripts: boolean;
  /** Only docs changed: nothing but the always-checks. */
  docsOnly: boolean;
  /** Why each group is on: shown in the run's summary. */
  why: Record<string, string[]>;
};

/** Shared API code: used everywhere, so a change runs every test. */
const CORE = [
  /^apps\/api\/src\/(app|http|types|seed|server)\.ts$/,
  /^apps\/api\/src\/db\//,
  /^apps\/api\/src\/people\/roles\.ts$/,
  /^apps\/api\/src\/orders\/events\.ts$/,
  /^apps\/api\/src\/notify\//,
  /^apps\/api\/src\/checks\//,
  /^apps\/api\/src\/testing\//,
  /^apps\/api\/(vitest\.config|tsconfig)/,
];
/** API files the web app imports: a change must still type-check the web. */
const SHARED_WITH_WEB = [/^apps\/api\/src\/types\.ts$/, /^apps\/api\/src\/auth\/workspaces\.ts$/, /^apps\/api\/package\.json$/];
const SECURITY = [
  /^apps\/api\/src\/auth\//,
  /^apps\/api\/src\/(http|app)\.ts$/,
  /^apps\/api\/src\/files\//,
  /^apps\/api\/src\/messages\//,
  /^apps\/api\/src\/org\//,
];
const WEB_AUTH = [/^apps\/web\/src\/(account|desk)\//, /^apps\/web\/src\/(api|auth|shell)\.tsx?$/];
const DEPS = [/(^|\/)package\.json$/, /^pnpm-lock\.yaml$/, /^pnpm-workspace\.yaml$/, /^\.npmrc$/];
const DOCKER = [/(^|\/)Dockerfile$/, /^apps\/web\/docker\//, /^docker-compose\.ya?ml$/, /^\.dockerignore$/];
const CONFIG = [/^apps\/api\/src\/server\.ts$/, /(^|\/)\.env[^/]*\.example$/];
const DOCS = [/^docs\//, /\.md$/i, /^\.gitignore$/, /^\.gitattributes$/];

const any = (rules: RegExp[], file: string) => rules.some((rule) => rule.test(file));

/** The groups for these changed files; `added` is the lines the change adds (for content rules). */
export function detect(files: string[], added = ""): Groups {
  const why: Record<string, string[]> = {};
  const on = (group: string, reason: string) => {
    const list = why[group] ?? [];
    if (!list.includes(reason)) list.push(reason);
    why[group] = list;
  };
  const related = new Set<string>();

  for (const file of files) {
    let known = false;
    const mark = (group: string) => {
      on(group, file);
      known = true;
    };
    if (any(DOCS, file)) known = true;
    if (file.startsWith("apps/web/")) mark("web");
    if (any(WEB_AUTH, file)) mark("webAuth");
    if (file.startsWith("apps/api/src/")) {
      mark("api");
      if (any(CORE, file)) mark("apiAll");
      else if (/\.tsx?$/.test(file)) related.add(file.replace(/^apps\/api\//, ""));
    }
    if (any(CORE, file) && !file.startsWith("apps/api/src/")) mark("apiAll");
    if (any(SHARED_WITH_WEB, file)) mark("web");
    if (any(SECURITY, file)) mark("security");
    if (file.startsWith("apps/api/migrations/") || file === "apps/api/src/db/schema.ts") mark("database");
    if (any(DEPS, file)) mark("deps");
    if (any(DOCKER, file)) mark("docker");
    if (any(CONFIG, file)) mark("config");
    if (file.startsWith("apps/api/scripts/")) mark("scripts");
    if (file.startsWith("scripts/ci/")) mark("ci");
    // The CI itself, or a file no rule knows: everything.
    if (file.startsWith(".github/") || !known) on("all", file);
  }

  // What the change adds, wherever it is.
  if (/sql\.raw\(/.test(added)) on("rawSql", "adds sql.raw(");
  if (/\bapp\.(get|post|patch|put|delete)\(\s*["'`]\/(api|webhooks)\//.test(added)) on("security", "adds a route");
  if (/dangerouslySetInnerHTML/.test(added)) on("security", "adds dangerouslySetInnerHTML");

  const all = Boolean(why.all);
  const has = (group: string) => all || Boolean(why[group]);
  const deps = has("deps");
  const database = has("database");
  const apiAll = all || deps || database || has("apiAll") || has("config") || has("ci");
  const api = apiAll || has("api") || has("security") || has("rawSql");
  return {
    always: true,
    web: has("web") || deps || has("ci"),
    webAuth: has("webAuth"),
    api,
    apiAll,
    apiRelated: apiAll ? [] : [...related].sort(),
    security: has("security") || has("rawSql") || deps,
    rawSql: has("rawSql"),
    database,
    deps,
    docker: has("docker") || deps || has("config"),
    config: has("config"),
    scripts: has("scripts"),
    docsOnly: files.length > 0 && files.every((file) => any(DOCS, file)),
    why,
  };
}

/** Everything on (main, nightly, by hand, or no base to compare with). */
export const everything = (reason: string): Groups => ({ ...detect([".github/everything"]), why: { all: [reason] } });

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

if (import.meta.main) {
  const base = process.argv[2];
  let groups: Groups;
  if (!base || base === "--all" || /^0+$/.test(base)) groups = everything(base === "--all" ? "asked for everything" : "no base to compare with");
  else {
    const files = git("diff", "--name-only", `${base}...HEAD`).split("\n").filter(Boolean);
    const added = git("diff", "--unified=0", `${base}...HEAD`, "--", ".", ":(exclude)pnpm-lock.yaml")
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .join("\n");
    groups = files.length ? detect(files, added) : everything("no changed files found");
  }
  console.log(JSON.stringify(groups, null, 2));
  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    const lines = Object.entries(groups)
      .filter(([key]) => key !== "why")
      .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(" ") : String(value)}`);
    appendFileSync(out, `${lines.join("\n")}\n`);
  }
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const rows = Object.entries(groups.why).map(([group, reasons]) => `| ${group} | ${reasons.slice(0, 6).join(", ")}${reasons.length > 6 ? ` and ${reasons.length - 6} more` : ""} |`);
    appendFileSync(summary, `### Checks switched on\n\n| Group | Because of |\n|---|---|\n${rows.join("\n")}\n`);
  }
}
