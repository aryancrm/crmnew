// Fetch now (docs/PLAN.md 25): the bidding team's own system had a Sync button for each portal beside
// its hourly fetch; these are the CRM's, one on each portal's card of the Tender finder. A person of the
// bidding team presses one and that portal's part of the robot runs at once instead of at the next hour:
// PhilGEPS reads its public list (and the screened tenders' papers); PS-PhilGEPS runs its Sync (only
// once a person has connected it). The robot itself is unchanged (workers/tender-finder); only who starts
// it is new. Two ways, set on the server:
//
// - github: GitHub is asked to run the robot's workflow now (.github/workflows/tender-finder.yml, on
//   main) for that portal only. Needs TENDER_FINDER_DISPATCH_TOKEN, a GitHub token that may start that
//   repository's workflows (fine-grained, "Actions: read and write" on that one repository, nothing else).
// - local (TENDER_FINDER_FETCH=local): the robot runs on this computer and hands in to this API, with
//   the key (TENDER_FINDER_KEY). For a developer's computer, or an office server with Chrome and the
//   robot installed (npm ci in workers/tender-finder).
//
// With neither set the buttons say the robot cannot be started from here. TENDER_FINDER_FETCH=off
// switches them off whatever is set.
//
// One press at a time for each portal: while a press waits for its portal's run (45 minutes at most,
// the workflow's own limit), or within 10 minutes of the last press of that portal, another is refused.

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import type { FetchState, FetchWay, Me, PortalFetch } from "../types";
import { psState } from "./robot-store";
import { recordsTenders } from "./service";

export type Portal = "philgeps" | "ps";
const WORKFLOW = "tender-finder.yml";
/** The robot's folder in this repository (apps/api/src/tenders → the repository's root). */
const WORKER = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../workers/tender-finder");
/** What runs on this computer for each portal. */
const SCRIPT: Record<Portal, string[]> = { philgeps: ["scraper.js", "--trigger=manual"], ps: ["ps/ps.mjs", "--trigger=manual"] };

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

/** Asks GitHub to run the robot's workflow on main now, for one portal. */
let dispatch = async (portal: Portal): Promise<void> => {
  const response = await fetch(`https://api.github.com/repos/${repository()}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${dispatchToken()}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      "user-agent": "crmnew-tender-finder",
    },
    body: JSON.stringify({ ref: "main", inputs: { portal } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 204) return;
  if (response.status === 401 || response.status === 403) throw new Error("GitHub refused the server's token (put it right on the server)");
  if (response.status === 404) throw new Error("GitHub does not know the robot's workflow, or the token may not see it");
  if (response.status === 422) throw new Error("GitHub's copy of the robot's workflow does not take a portal yet (this change is not on main)");
  throw new Error(`GitHub answered ${response.status}`);
};

// One robot per portal on this computer: a PS-PhilGEPS fetch never blocks a PhilGEPS one (change log 187).
const children = new Map<Portal, ChildProcess>();

/** Starts one portal's robot on this computer; it hands in to this API with the key. */
let runHere = (portal: Portal, onEnd: (problem: string | null) => void): void => {
  if (!existsSync(join(WORKER, "node_modules"))) throw new Error("The robot is not installed on this computer (in workers/tender-finder run: npm ci)");
  const robot = spawn(process.execPath, SCRIPT[portal], {
    cwd: WORKER,
    env: { ...process.env, CRM_URL: `http://localhost:${process.env.PORT ?? 4100}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.set(portal, robot);
  const say = (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) console.log(`robot (${portal}): ${line}`);
  };
  robot.stdout?.on("data", say);
  robot.stderr?.on("data", say);
  robot.on("error", (error) => {
    children.delete(portal);
    onEnd(`The robot could not start: ${error.message}`);
  });
  robot.on("exit", (code) => {
    children.delete(portal);
    onEnd(code === 0 ? null : `The robot stopped (exit ${code}); the API's log says why`);
  });
};

/** For the tests: start the robot some other way. */
export function useFetchers(fetchers: { dispatch?: (portal: Portal) => Promise<void>; runHere?: (portal: Portal, onEnd: (problem: string | null) => void) => void }): void {
  if (fetchers.dispatch) dispatch = fetchers.dispatch;
  if (fetchers.runHere) runHere = fetchers.runHere;
}

/** A run of that portal started by a person (not the hourly schedule, not the bridge's hand-over) handed
 *  in after the press. */
const runAfter = (portal: Portal) =>
  sql`exists (select 1 from tender_find_run r where r.source = ${portal} and r.at > a.at and coalesce(r.trigger, '') not in ('schedule', 'feed'))`;

/** A press of that portal still waiting for its run: asked less than 45 minutes ago, and either within
 *  the last 10 minutes or with no run of it handed in since. */
const waiting = (portal: Portal) => sql`a.portal = ${portal} and a.status = 'asked' and a.at > now() - interval '45 minutes'
  and (a.at > now() - interval '10 minutes' or not ${runAfter(portal)})`;

const iso = (column: string) => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);

async function portalState(db: Database, portal: Portal): Promise<PortalFetch> {
  const [running] = await rows<{ by: string | null; at: string; done: boolean }>(
    db,
    sql`select p.name as by, ${iso("a.at")} as at, ${runAfter(portal)} as done
      from tender_find_ask a left join person p on p.id = a.by_person
      where ${waiting(portal)} order by a.at desc limit 1`,
  );
  const [failed] = await rows<{ at: string; note: string | null }>(
    db,
    sql`select ${iso("a.at")} as at, a.note from tender_find_ask a
      where a.portal = ${portal} and a.status = 'failed' and a.at > now() - interval '1 day'
        and not exists (select 1 from tender_find_ask b where b.portal = ${portal} and b.at > a.at)
        and not exists (select 1 from tender_find_run r where r.source = ${portal} and r.at > a.at)
      order by a.at desc limit 1`,
  );
  return {
    running: running ? { by: running.by, at: running.at, done: running.done } : null,
    failed: failed ? { at: failed.at, note: failed.note } : null,
  };
}

/** What the Tender finder shows of Fetch now on each portal's card: whether it can be pressed, a press
 *  still running, and the last press that could not start (until a run comes after it). */
export async function fetchState(db: Database): Promise<FetchState> {
  const [philgeps, ps] = await Promise.all([portalState(db, "philgeps"), portalState(db, "ps")]);
  return { way: fetchWay(), philgeps, ps };
}

const failAsk = (db: Database, id: number, note: string) =>
  db.execute(sql`update tender_find_ask set status = 'failed', note = ${note.slice(0, 300)} where id = ${id}`);

/** On the API's start: a press whose robot ran on this computer cannot still be running (the robot ends
 *  with the API that started it), so it is closed with a word instead of holding its portal's button on
 *  "Fetching…" for up to 45 minutes. A run it handed in before the restart still counts. */
export async function closeLocalAsks(db: Database): Promise<number> {
  const closed = await rows<{ id: number }>(
    db,
    sql`update tender_find_ask set status = 'failed', note = 'The CRM restarted while the robot ran on this computer; press Fetch now again.'
      where via = 'local' and status = 'asked' returning id::int as id`,
  );
  // PS-PhilGEPS's own Sync status said "running" when its robot was cut off: it would skip the next press
  // for 6 minutes (psSync claimSync) and show the cut-off stage as if still reading.
  if (closed.length)
    await db.execute(sql`update tender_robot_row set value = value || jsonb_build_object('status', 'failed', 'error', 'Stopped when the CRM restarted.', 'finished_at', ${new Date().toISOString()}::text)
      where tbl = 'ps_sync_status' and key = 'latest' and value->>'status' = 'running'`);
  return closed.length;
}

/** A portal's Fetch now button: that portal's robot runs now. Refused while an earlier press of it runs. */
export async function fetchNow(db: Database, me: Me, portal: Portal): Promise<{ via: "github" | "local"; portal: Portal }> {
  if (!(await recordsTenders(db, me))) throw new Refusal(403, "not_allowed", "The tender finder is the bidding team's.");
  const way = fetchWay();
  if (way === "off") throw new Refusal(409, "fetch_off", "The robot can't be started from this server; it still runs by itself every hour.");
  if (portal === "ps" && !(await psState(db)).connected)
    throw new Refusal(409, "ps_not_connected", "PS-PhilGEPS is not connected: press Connect PS-PhilGEPS first (its log-in has a captcha).");
  if (way === "local" && children.has(portal))
    throw new Refusal(409, "fetch_running", `${portal === "ps" ? "PS-PhilGEPS" : "PhilGEPS"}'s robot is already running on this computer; its result shows here when it ends.`);
  // One statement, so two people pressing at once make one press.
  const [ask] = await rows<{ id: number }>(
    db,
    sql`insert into tender_find_ask (by_person, via, portal)
      select ${me.id}, ${way}, ${portal} where not exists (select 1 from tender_find_ask a where ${waiting(portal)})
      returning id::int as id`,
  );
  if (!ask) throw new Refusal(409, "fetch_running", "This portal's robot was started a moment ago; its result shows here when it ends.");
  try {
    if (way === "github") await dispatch(portal);
    else
      runHere(portal, (problem) => {
        if (problem) void failAsk(db, ask.id, problem).catch((error) => console.error("tender finder: couldn't note the robot's end", error));
      });
  } catch (error) {
    const note = error instanceof Error ? error.message : String(error);
    await failAsk(db, ask.id, note);
    throw new Refusal(409, "fetch_failed", `The robot could not be started: ${note}.`);
  }
  return { via: way, portal };
}
