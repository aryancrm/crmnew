// The PS-PhilGEPS log-in from any team laptop (docs/PLAN.md 25): the bidding system's pop-up log-in,
// moved into the CRM. PS-PhilGEPS's log-in has a Google captcha that only works on philgeps.gov.ph, so a
// person ticks it in a real Chrome window on their own laptop; the session then serves the whole team
// (the robot keeps it alive) until PS-PhilGEPS ends it, and then anyone connects again.
//
// 1. A person of the bidding team presses Connect PS-PhilGEPS on the Tender finder: the CRM gives a
//    one-time code (15 minutes) and the page opens "bishnoi-ps-connect:start?code=…".
// 2. On a laptop set up once ("Set up this laptop": a setup file made here, workers/tender-finder/ps/laptop),
//    that link runs the bidding system's own log-in module (ps-philgeps-session.js connectLaptop, unchanged).
//    With the code it asks here for the account (begin), says when the password is sent (submitted) or
//    refused, and hands the session back (done). The laptop keeps no key, no password and no session.
// 3. The session is kept sealed where the robot keeps its own (tender_robot_row), and PS-PhilGEPS shows
//    as connected for everyone.
//
// The log-in rules are the bidding system's (its loginGuard.mjs), on the robot's log-in records
// (tender_find_login, site "ps-philgeps"): three refused log-ins in an hour pause it for an hour; at most
// 6 log-ins that sent the password an hour and 20 a day; a minute between two log-ins.
// The account is the server's: PS_PHILGEPS_USERNAME and PS_PHILGEPS_PASSWORD.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import type { Me } from "../types";
import { LAPTOP_KIT } from "./laptop-kit.generated";
import { noteRobotLogin } from "./papers";
import { writeRobotRows } from "./robot-store";
import { recordsTenders } from "./service";

const SITE = "ps-philgeps";
const MINUTES = { login: 15, setup: 60 } as const;
type Purpose = keyof typeof MINUTES;

/** A key only this server has, from its SECRETS_KEY (a separate key from the one that seals secrets). */
function signingKey(): Buffer {
  const secret = process.env.SECRETS_KEY;
  if (!secret && process.env.NODE_ENV === "production") throw new Error("SECRETS_KEY isn't set: laptop log-in codes can't be made.");
  return createHash("sha256").update(`ps-laptop-connect:${secret ?? "2mg-new-crm-local-only"}`).digest();
}
const sign = (payload: string) => createHmac("sha256", signingKey()).update(payload).digest();

/** A one-time code for a person of the bidding team: a log-in (15 minutes) or the laptop's setup files (60). */
export function issueCode(personId: number, purpose: Purpose, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ i: personId, p: purpose, x: now + MINUTES[purpose] * 60_000 })).toString("base64url");
  return `${payload}.${sign(payload).toString("base64url")}`;
}

/** The person a valid, unexpired code of that purpose was made for; null otherwise. */
export function checkCode(code: unknown, purpose: Purpose, now = Date.now()): number | null {
  if (typeof code !== "string" || code.length > 400) return null;
  const [payload, mac, extra] = code.split(".");
  if (!payload || !mac || extra !== undefined) return null;
  const given = Buffer.from(mac, "base64url");
  const expected = sign(payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { i, p, x } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { i: unknown; p: unknown; x: unknown };
    return typeof i === "number" && p === purpose && typeof x === "number" && now < x ? i : null;
  } catch {
    return null;
  }
}

type Cookie = { name: string; value: string; domain: string } & Record<string, unknown>;
/** The cookies a laptop hands over: PS-PhilGEPS's only (at most 60, none over 8,000 characters), else null. */
export function philgepsCookies(cookies: unknown): Cookie[] | null {
  if (!Array.isArray(cookies) || !cookies.length || cookies.length > 60) return null;
  const ours = cookies.filter(
    (c): c is Cookie =>
      Boolean(c) && typeof c.name === "string" && typeof c.value === "string" && typeof c.domain === "string" && c.domain.replace(/^\./, "").endsWith("philgeps.gov.ph") && c.value.length < 8000,
  );
  return ours.length === cookies.length ? ours : null;
}

const manila = (ms: number) => new Date(ms).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });

/** The bidding system's log-in rules for PS-PhilGEPS (its loginGuard.mjs checkLogin, for a person): why a
 *  new log-in must wait, or null when it may go ahead. */
export async function loginWait(db: Database, now = Date.now()): Promise<string | null> {
  const times = (
    await rows<{ at: string; outcome: string }>(
      db,
      sql`select to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at, outcome from tender_find_login
        where site = ${SITE} and at >= now() - interval '24 hours' order by at desc, id desc`,
    )
  ).map((row) => ({ ...row, ms: Date.parse(row.at) }));
  const lastOk = times.find((row) => row.outcome === "ok")?.ms ?? 0;
  const refused = times.filter((row) => row.outcome === "rejected" && row.ms > lastOk && now - row.ms < 3_600_000);
  if (refused.length >= 3) return `PS-PhilGEPS refused ${refused.length} log-ins within the hour. To protect the account, log-ins are paused until ${manila((refused[2]?.ms ?? now) + 3_600_000)}.`;
  // Only log-ins that sent the password count toward the limits; every start counts for the minute between two.
  const sent = times.filter((row) => row.outcome === "submitted");
  const lastHour = sent.filter((row) => now - row.ms < 3_600_000);
  if (lastHour.length >= 6) return `PS-PhilGEPS has been logged in to ${lastHour.length} times in the last hour. To protect the account, the next log-in is allowed at ${manila((lastHour[5]?.ms ?? now) + 3_600_000)}.`;
  if (sent.length >= 20) return `PS-PhilGEPS has been logged in to ${sent.length} times today. To protect the account, the next log-in is allowed at ${manila((sent[19]?.ms ?? now) + 86_400_000)}.`;
  const lastStart = times.find((row) => row.outcome === "started");
  if (lastStart && now - lastStart.ms < 60_000) return `PS-PhilGEPS was logged in to less than a minute ago. Try again at ${manila(lastStart.ms + 60_000)}.`;
  return null;
}

/** The Connect PS-PhilGEPS button: a one-time log-in code, or the laptop's setup file. */
export async function laptopCode(db: Database, me: Me, purpose: Purpose, crmUrl: string): Promise<{ code: string; at: string } | { script: string }> {
  if (!(await recordsTenders(db, me))) throw new Refusal(403, "not_allowed", "The tender finder is the bidding team's.");
  // "at": the server's time, from which the page follows this log-in's steps (FoundList robot.ps.login)
  if (purpose === "login") return { code: issueCode(me.id, "login"), at: new Date().toISOString() };
  return { script: setupScript(issueCode(me.id, "setup"), crmUrl) };
}

/** One of the laptop's files, for its setup file (with a setup code). */
export function laptopFile(code: unknown, name: string): string {
  if (!checkCode(code, "setup")) throw new Refusal(401, "expired", "This setup file has expired. Download it again from the Tender finder.");
  if (!Object.hasOwn(LAPTOP_KIT, name)) throw new Refusal(404, "not_found", "No such file.");
  return LAPTOP_KIT[name] as string;
}

type LaptopStep = { action?: unknown; code?: unknown; ownAccount?: unknown; detail?: unknown; outcome?: unknown; cookies?: unknown; savedAt?: unknown };

/** What the laptop's log-in module says, step by step, with its one-time log-in code. Answers in the
 *  shape it reads ({ ok, error, code }), so the bidding system's module runs unchanged. */
export async function laptopStep(db: Database, body: LaptopStep): Promise<{ status: 200 | 400 | 401 | 429 | 500; body: Record<string, unknown> }> {
  const fail = (status: 400 | 401 | 429 | 500, error: string, code?: string) => ({ status, body: { ok: false, error, ...(code ? { code } : {}) } });
  const by = checkCode(body.code, "login");
  if (!by) return fail(401, "This log-in link has expired. Press Connect PS-PhilGEPS in Bishnoi One again.");
  const [person] = await rows<{ name: string }>(db, sql`select name from person where id = ${by}`);
  const source = `team laptop (${person?.name ?? by})`.slice(0, 40);
  const detail = typeof body.detail === "string" ? body.detail : null;

  if (body.action === "begin") {
    const username = process.env.PS_PHILGEPS_USERNAME;
    const password = process.env.PS_PHILGEPS_PASSWORD;
    const known = Boolean(username && password);
    // A refusal here is also kept, so the page that opened this log-in can say why it stopped.
    if (!known && !body.ownAccount) {
      const said = "The PS-PhilGEPS account is not set on Bishnoi One's server yet (PS_PHILGEPS_USERNAME, PS_PHILGEPS_PASSWORD).";
      await noteRobotLogin(db, { site: SITE, outcome: "error", detail: said, source });
      return fail(500, said, "NO_CREDENTIALS");
    }
    const wait = await loginWait(db);
    if (wait) {
      await noteRobotLogin(db, { site: SITE, outcome: "paused", detail: wait, source });
      return fail(429, wait, "LOGIN_PAUSED");
    }
    await noteRobotLogin(db, { site: SITE, outcome: "started", source });
    return { status: 200, body: known ? { ok: true, username, password } : { ok: true } };
  }
  if (body.action === "submitted") {
    await noteRobotLogin(db, { site: SITE, outcome: "submitted", source });
    return { status: 200, body: { ok: true } };
  }
  if (body.action === "refused") {
    await noteRobotLogin(db, { site: SITE, outcome: "rejected", detail, source });
    return { status: 200, body: { ok: true } };
  }
  if (body.action === "failed") {
    await noteRobotLogin(db, { site: SITE, outcome: body.outcome === "cancelled" ? "cancelled" : "error", detail, source });
    return { status: 200, body: { ok: true } };
  }
  if (body.action === "done") {
    const cookies = philgepsCookies(body.cookies);
    if (!cookies) return fail(400, "The laptop sent no PS-PhilGEPS session.");
    const savedAt = typeof body.savedAt === "string" && !Number.isNaN(Date.parse(body.savedAt)) ? new Date(body.savedAt).toISOString() : new Date().toISOString();
    // Where the robot keeps its own session (sealed) and its Sync's status: the robot uses it from its next run.
    await writeRobotRows(db, "ps_philgeps_session", { upsert: [{ key: "current", value: { id: "current", cookies, saved_at: savedAt } }] });
    const [status] = await rows<{ value: Record<string, unknown> }>(db, sql`select value from tender_robot_row where tbl = 'ps_sync_status' and key = 'latest'`);
    await writeRobotRows(db, "ps_sync_status", { upsert: [{ key: "latest", value: { ...(status?.value ?? { id: "latest" }), connected_at: savedAt } }] });
    await noteRobotLogin(db, { site: SITE, outcome: "ok", source });
    return { status: 200, body: { ok: true } };
  }
  return fail(400, "Unknown action.");
}

/** The laptop's setup file (Windows): checks Node.js and Google Chrome, downloads the log-in files into
 *  %LOCALAPPDATA%\Bishnoi One PS-PhilGEPS Connect, tells them where Bishnoi One is, installs them (with the
 *  laptop's own Chrome, not Puppeteer's) and teaches Windows the "bishnoi-ps-connect:" link. Its own folder
 *  and link: the bidding system's set-up on the same laptop is left as it is. */
export function setupScript(code: string, crmUrl: string): string {
  const crm = crmUrl.replace(/\/+$/, "");
  const files = Object.keys(LAPTOP_KIT).join("','");
  const lines = [
    "@echo off",
    "setlocal",
    "title Set up the PS-PhilGEPS log-in for Bishnoi One",
    `set "CRM=${crm}"`,
    `set "CODE=${code}"`,
    'set "DIR=%LOCALAPPDATA%\\Bishnoi One PS-PhilGEPS Connect"',
    "echo Setting up the PS-PhilGEPS log-in for Bishnoi One on this laptop. This takes a few minutes.",
    "echo.",
    "where node >nul 2>nul",
    "if errorlevel 1 goto nonode",
    'set "CHROME="',
    'if exist "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" set "CHROME=1"',
    'if exist "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe" set "CHROME=1"',
    'if exist "%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe" set "CHROME=1"',
    "if not defined CHROME goto nochrome",
    'if not exist "%DIR%" mkdir "%DIR%"',
    "echo 1/3 Downloading the log-in files...",
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; foreach ($f in @('${files}')) { Invoke-WebRequest -UseBasicParsing -Uri ('%CRM%/api/ps-philgeps/laptop?code=%CODE%&file=' + [uri]::EscapeDataString($f)) -OutFile (Join-Path '%DIR%' $f) }; $v = Join-Path '%DIR%' 'Connect PS-PhilGEPS.vbs'; [IO.File]::WriteAllText($v, ([IO.File]::ReadAllText($v) -replace '\\r?\\n', [Environment]::NewLine)); [IO.File]::WriteAllText((Join-Path '%DIR%' '.env'), 'DASHBOARD_URL=%CRM%' + [Environment]::NewLine)"`,
    "if errorlevel 1 goto nodownload",
    "echo 2/3 Installing (one time)...",
    'cd /d "%DIR%"',
    'set "PUPPETEER_SKIP_DOWNLOAD=true"',
    "call npm install --omit=dev --no-audit --no-fund --loglevel=error",
    "if errorlevel 1 goto noinstall",
    "echo 3/3 Linking Bishnoi One's Connect PS-PhilGEPS button to this laptop...",
    "node register-connect-link.js",
    "if errorlevel 1 goto noinstall",
    "echo.",
    "echo Done. In Bishnoi One press Connect PS-PhilGEPS: the log-in opens here in a small Chrome window.",
    "pause",
    "exit /b 0",
    ":nonode",
    "echo Node.js is needed first. Installing it...",
    "winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements",
    "if errorlevel 1 echo Could not install it here. Install the LTS version from https://nodejs.org then run this file again.",
    "echo.",
    "echo Then close this window and double-click this setup file again to finish.",
    "pause",
    "exit /b 1",
    ":nochrome",
    "echo Google Chrome is needed. Install it from https://www.google.com/chrome/ then run this file again.",
    "pause",
    "exit /b 1",
    ":nodownload",
    "echo The files could not be downloaded. Check the internet; if it says expired, download the setup file again from the Tender finder.",
    "pause",
    "exit /b 1",
    ":noinstall",
    "echo The setup did not finish. Run this file again; if it keeps failing, tell the admin.",
    "pause",
    "exit /b 1",
  ];
  return `${lines.join("\r\n")}\r\n`;
}
