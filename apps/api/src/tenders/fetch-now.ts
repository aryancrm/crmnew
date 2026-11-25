// Fetch now (docs/PLAN.md 25): the bidding team's own system had a Sync button beside its hourly
// fetch; this is the CRM's. A person of the bidding team presses it on the Tender finder and the
// robot runs at once instead of at the next hour. The robot itself is unchanged
// (workers/tender-finder); only who starts it is new. Two ways, set on the server:
//
// - github: GitHub is asked to run the robot's workflow now (.github/workflows/tender-finder.yml,
//   on main), the same run as the hourly one: both portals, the bridge, the papers. Needs
//   TENDER_FINDER_DISPATCH_TOKEN, a GitHub token that may start that repository's workflows
//   (fine-grained, "Actions: read and write" on that one repository, nothing else).
// - local (TENDER_FINDER_FETCH=local): the robot runs on this computer and hands in to this API,
//   with the key (TENDER_FINDER_KEY). For a developer's computer, or an office server with Chrome
//   and the robot installed (npm ci in workers/tender-finder). It reads the public PhilGEPS list only.
//
// With neither set the button says the robot cannot be started from here. TENDER_FINDER_FETCH=off
// switches it off whatever is set.
//
// One press at a time: while a press waits for its run (45 minutes at most, the workflow's own
// limit), or within 10 minutes of the last press, another is refused.

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import type { FetchState, FetchWay, Me } from "../types";
import { recordsTenders } from "./service";

const WORKFLOW = "tender-finder.yml";
/** The robot's folder in this repository (apps/api/src/tenders → the repository's root). */
const WORKER = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../workers/tender-finder");

const repository = () => (process.env.TENDER_FINDER_GITHUB || "aryancrm/crmnew").trim();
const dispatchToken = () => (process.env.TENDER_FINDER_DISPATCH_TOKEN ?? "").trim();
const keySet = () => (process.env.TENDER_FINDER_KEY ?? "").trim().length >= 24;

/** How a press starts the robot on this server, or "off" when it cannot. */
export function fetchWay(): FetchWay {
  const asked = (process.env.TENDER_FINDER_FETCH ?? "").trim();
  if (asked === "off") return "off";
  if (asked === "local") return keySet() ? "local" : "off";
  return dispatchToken() && repository() !== "off" ? "github" : "off";
}

/** Asks GitHub to run the robot's workflow on main now. */
let dispatch = async (): Promise<void> => {
  const response = await fetch(`https://api.github.com/repos/${repository()}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${dispatchToken()}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      "user-agent": "crmnew-tender-finder",
    },
    body: JSON.stringify({ ref: "main" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 204) return;
  if (response.status === 401 || response.status === 403) throw new Error("GitHub refused the server's token (put it right on the server)");
  if (response.status === 404) throw new Error("GitHub does not know the robot's workflow, or the token may not see it");
  throw new Error(`GitHub answered ${response.status}`);
};

let child: ChildProcess | null = null;

/** Starts the robot on this computer; it hands in to this API with the key. */
let runHere = (onEnd: (problem: string | null) => void): void => {
  if (!existsSync(join(WORKER, "node_modules"))) throw new Error("The robot is not installed on this computer (in workers/tender-finder run: npm ci)");
  const robot = spawn(process.execPath, ["scraper.js", "--trigger=manual"], {
    cwd: WORKER,
    env: { ...process.env, CRM_URL: `http://localhost:${process.env.PORT ?? 4100}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = robot;
  const say = (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) console.log(`robot: ${line}`);
  };
  robot.stdout?.on("data", say);
  robot.stderr?.on("data", say);
  robot.on("error", (error) => {
    child = null;
    onEnd(`The robot could not start: ${error.message}`);
  });
  robot.on("exit", (code) => {
    child = null;
    onEnd(code === 0 ? null : `The robot stopped (exit ${code}); the API's log says why`);
  });
};

/** For the tests: start the robot some other way. */
export function useFetchers(fetchers: { dispatch?: () => Promise<void>; runHere?: (onEnd: (problem: string | null) => void) => void }): void {
  if (fetchers.dispatch) dispatch = fetchers.dispatch;
  if (fetchers.runHere) runHere = fetchers.runHere;
}

/** A press still waiting for its run: asked less than 45 minutes ago, and either within the last
 *  10 minutes or with no run started by a person (not the hourly schedule) handed in since. */
const WAITING = sql`a.status = 'asked' and a.at > now() - interval '45 minutes'
  and (a.at > now() - interval '10 minutes'
    or not exists (select 1 from tender_find_run r where r.source = 'philgeps' and r.at > a.at and coalesce(r.trigger, '') <> 'schedule'))`;

const iso = (column: string) => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);

/** What the Tender finder shows of Fetch now: whether it can be pressed, a press still running,
 *  and the last press that could not start (until a run comes after it). */
export async function fetchState(db: Database): Promise<FetchState> {
  const [running] = await rows<{ by: string | null; at: string; done: boolean }>(
    db,
    sql`select p.name as by, ${iso("a.at")} as at,
        exists (select 1 from tender_find_run r where r.source = 'philgeps' and r.at > a.at and coalesce(r.trigger, '') <> 'schedule') as done
      from tender_find_ask a left join person p on p.id = a.by_person
      where ${WAITING} order by a.at desc limit 1`,
  );
  const [failed] = await rows<{ at: string; note: string | null }>(
    db,
    sql`select ${iso("a.at")} as at, a.note from tender_find_ask a
      where a.status = 'failed' and a.at > now() - interval '1 day'
        and not exists (select 1 from tender_find_ask b where b.at > a.at)
        and not exists (select 1 from tender_find_run r where r.at > a.at)
      order by a.at desc limit 1`,
  );
  return {
    way: fetchWay(),
    running: running ? { by: running.by, at: running.at, done: running.done } : null,
    failed: failed ? { at: failed.at, note: failed.note } : null,
  };
}

const failAsk = (db: Database, id: number, note: string) =>
  db.execute(sql`update tender_find_ask set status = 'failed', note = ${note.slice(0, 300)} where id = ${id}`);

/** The Fetch now button: the robot runs now. Refused while an earlier press still runs. */
export async function fetchNow(db: Database, me: Me): Promise<{ via: "github" | "local" }> {
  if (!(await recordsTenders(db, me))) throw new Refusal(403, "not_allowed", "The tender finder is the bidding team's.");
  const way = fetchWay();
  if (way === "off") throw new Refusal(409, "fetch_off", "The robot can't be started from this server; it still runs by itself every hour.");
  if (way === "local" && child) throw new Refusal(409, "fetch_running", "The robot is already running; its result shows here when it ends.");
  // One statement, so two people pressing at once make one press.
  const [ask] = await rows<{ id: number }>(
    db,
    sql`insert into tender_find_ask (by_person, via)
      select ${me.id}, ${way} where not exists (select 1 from tender_find_ask a where ${WAITING})
      returning id::int as id`,
  );
  if (!ask) throw new Refusal(409, "fetch_running", "The robot was started a moment ago; its result shows here when it ends.");
  try {
    if (way === "github") await dispatch();
    else
      runHere((problem) => {
        if (problem) void failAsk(db, ask.id, problem).catch((error) => console.error("tender finder: couldn't note the robot's end", error));
      });
  } catch (error) {
    const note = error instanceof Error ? error.message : String(error);
    await failAsk(db, ask.id, note);
    throw new Refusal(409, "fetch_failed", `The robot could not be started: ${note}.`);
  }
  return { via: way };
}
