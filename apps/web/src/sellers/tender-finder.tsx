// The tender finder inside the CRM (docs/PLAN.md 24; Aryan, 23 Nov: "one CRM, not two"): what the
// robot found on PhilGEPS and PS-PhilGEPS for our medicines (New), the team's pick (Screened), the
// ones made tenders, and everything found; a notice's own page with what it asks line by line;
// and the join: Make it a tender, after which the tender's own page takes over (tenders.tsx).

import type { Catalogue, CustomerList, FoundDetail, FoundDocs, FoundLine, FoundList, FoundPapers, FoundSort, FoundTender, FoundView, TenderMode } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, CircleAlert, CircleCheck, ExternalLink, Loader2, Search, X } from "lucide-react";
import { createPortal } from "react-dom";
import { type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { bidDateText, deliveryText } from "./bid-dates";
import { shortPeso } from "../ceo";
import { Button, CARD, dayLabel, Dialog, Facts, PageHead, PageState, Pill, Problem, peso, Tabs, Tile, useAction } from "../ui";

const PORTAL = { philgeps: "PhilGEPS", ps: "PS-PhilGEPS" } as const;
const MODE: Record<TenderMode, string> = {
  competitive_bidding: "Competitive bidding",
  limited_source: "Limited source",
  direct_contracting: "Direct contracting",
  direct_acquisition: "Direct acquisition",
  repeat_order: "Repeat order",
  small_value: "Small value procurement",
  negotiated: "Negotiated",
  direct_sales: "Direct sales",
  other: "Other",
};
const when = (iso: string) => new Date(iso).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });
const toCentavos = (pesos: string) => Math.round(Number(pesos.replace(/[^\d.]/g, "")) * 100) || 0;
const count = (value: number) => value.toLocaleString("en-PH", { maximumFractionDigits: 2 });

/** How long until the bids close, in the words of the list. */
function closing(found: Pick<FoundTender, "closingAt" | "open">): { text: string; tone: string } {
  if (!found.closingAt) return { text: "no closing date read", tone: "text-slate-500" };
  if (!found.open) return { text: `closed ${when(found.closingAt)}`, tone: "text-slate-400" };
  const days = Math.floor((Date.parse(found.closingAt) - Date.now()) / 86_400_000);
  return {
    text: `${when(found.closingAt)} · ${days <= 0 ? "today" : days === 1 ? "1 day left" : `${days} days left`}`,
    tone: days <= 3 ? "text-rose-700" : days <= 7 ? "text-amber-700" : "text-slate-600",
  };
}

function Molecules({ names }: { names: string[] }) {
  if (names.length === 0) return <span className="text-[12px] text-slate-400">none of ours</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {names.map((name) => (
        <span key={name} className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11.5px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
          {name}
        </span>
      ))}
    </span>
  );
}

/** Where a found tender stands, and New when the robot first fetched it in the last 24 hours. */
function State({ found }: { found: FoundTender }) {
  const fresh = Date.now() - Date.parse(found.firstSeenAt) < 86_400_000;
  const state = found.tenderId ? (
    <Pill tone="good">Tender {found.tenderCode}</Pill>
  ) : found.screenedAt ? (
    <Pill tone="info">Screened</Pill>
  ) : !found.open ? (
    <Pill>Closed</Pill>
  ) : found.molecules.length ? null : found.source === "ps" ? (
    <span title="On PS-PhilGEPS's Bid Match (the portal matched it to the company's products); its medicines show once its papers are read.">
      <Pill tone="info">Bid Match</Pill>
    </span>
  ) : (
    <Pill>Not ours</Pill>
  );
  return (
    <>
      {fresh && (
        <span title={`First fetched ${when(found.firstSeenAt)}`}>
          <Pill tone="brand">New</Pill>
        </span>
      )}
      {state}
    </>
  );
}

/** The status box at the bottom right (as the bidding system shows its Sync): what a press of Fetch now
 *  is doing, step by step, and how it ended. One box per portal, stacked. */
type Tone = "work" | "good" | "bad" | "warn";
const TONE: Record<Tone, string> = {
  work: "border-sky-200",
  good: "border-emerald-300",
  bad: "border-rose-300",
  warn: "border-amber-300",
};
function dock(): HTMLElement {
  let element = document.getElementById("fetch-status-dock");
  if (!element) {
    element = document.createElement("div");
    element.id = "fetch-status-dock";
    element.setAttribute("aria-live", "polite");
    element.className = "fixed bottom-4 right-4 z-[55] flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2 print:hidden";
    document.body.appendChild(element);
  }
  return element;
}
function StatusBox({ tone, title, children, onClose }: { tone: Tone; title: string; children?: ReactNode; onClose?: () => void }) {
  const icon =
    tone === "work" ? (
      <Loader2 className="size-4 shrink-0 animate-spin text-sky-600" aria-hidden="true" />
    ) : tone === "good" ? (
      <CircleCheck className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
    ) : (
      <CircleAlert className={`size-4 shrink-0 ${tone === "bad" ? "text-rose-600" : "text-amber-600"}`} aria-hidden="true" />
    );
  return createPortal(
    <div className={`rounded-xl border bg-white px-3.5 py-3 text-[12.5px] text-slate-700 shadow-lg ${TONE[tone]}`} role="status">
      <div className="flex items-start gap-2">
        <span className="mt-0.5">{icon}</span>
        <b className="min-w-0 flex-1 text-[13px] text-slate-900">{title}</b>
        {onClose && (
          <button type="button" aria-label="Close" className="-m-1 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={onClose}>
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {children && <div className="mt-1 pl-6">{children}</div>}
    </div>,
    dock(),
  );
}

type PortalFetchState = FoundList["robot"]["fetch"]["ps"];

/** A Fetch now this page pressed, followed to its end in the status box: waiting for its run, then that
 *  portal's last run (found, matched, new) or why it did not finish. A good end closes by itself. */
function FetchStatus({ name, state, runs, stage, onClose }: { name: string; state: PortalFetchState; runs: FindRunRow[]; stage?: string | null; onClose: () => void }) {
  const running = state.running;
  const last = runs[0];
  const ended = running?.done ? (last?.status === "failed" ? "bad" : "good") : null;
  useEffect(() => {
    if (ended !== "good") return;
    const timer = setTimeout(onClose, 20_000);
    return () => clearTimeout(timer);
  }, [ended]);
  if (running && !running.done)
    return (
      <StatusBox tone="work" title={`Fetching ${name}…`} onClose={onClose}>
        Started {running.by ? `by ${running.by} ` : ""}at {when(running.at)}. It takes a few minutes; this page looks every 15 seconds.
        {stage ? <span className="block text-slate-500">{stage}</span> : null}
      </StatusBox>
    );
  if (running?.done && last)
    return (
      <StatusBox tone={ended === "bad" ? "bad" : "good"} title={ended === "bad" ? `${name}: the fetch failed` : `${name} fetched`} onClose={onClose}>
        <RunLine run={last} />
      </StatusBox>
    );
  if (state.failed)
    return (
      <StatusBox tone="bad" title={`${name}: the fetch did not finish`} onClose={onClose}>
        {state.failed.note ?? "No reason was given."}
      </StatusBox>
    );
  return null;
}

/** What a laptop log-in's last step means for the person who opened it. */
const LOGIN_STEP: Record<string, { tone: Tone; title: string; said?: string; final?: boolean }> = {
  started: { tone: "work", title: "Chrome is open on this laptop", said: "Tick “I'm not a robot”, then the log-in goes through by itself." },
  submitted: { tone: "work", title: "Logging in to PS-PhilGEPS…", said: "The password was sent; waiting for PS-PhilGEPS." },
  rejected: { tone: "warn", title: "PS-PhilGEPS refused the log-in" },
  ok: { tone: "good", title: "Logged in to PS-PhilGEPS", said: "Saving the session for everyone…" },
  error: { tone: "bad", title: "The PS-PhilGEPS log-in did not finish", final: true },
  cancelled: { tone: "bad", title: "The PS-PhilGEPS log-in was closed", said: "The Chrome window was closed before the log-in finished.", final: true },
  paused: { tone: "bad", title: "PS-PhilGEPS log-ins are paused", final: true },
};

/** PS-PhilGEPS's Fetch now, which connects first when it must (the bidding system's Sync button: "you
 *  cannot fetch if you do not connect", the developer, 25 Nov). Not connected: the press opens the log-in
 *  on this laptop (the "bishnoi-ps-connect:" link with a one-time code; API tenders/laptop-login.ts); a
 *  person ticks "I'm not a robot"; once the session is saved the fetch starts by itself. Every step the
 *  laptop reports (robot.ps.login, since the server's time of this press) shows in the status box at the
 *  bottom right, and a step that ends the log-in (no account on the server, log-ins paused, an error,
 *  the window closed) stops the waiting at once and says why. Nothing heard in 3 minutes: it says so. A
 *  laptop not set up yet gets the one-time setup file. */
function PsFetch({ way, state, ps, runs }: { way: FoundList["robot"]["fetch"]["way"]; state: PortalFetchState; ps: FoundList["robot"]["ps"]; runs: FindRunRow[] }) {
  const queries = useQueryClient();
  const action = useAction();
  const connected = ps.connected;
  // The press that opened a log-in: the server's time of it (its steps come after), and this page's (for the 3 minutes)
  const [since, setSince] = useState<{ server: string; local: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [ended, setEnded] = useState<{ tone: Tone; title: string; said: string } | null>(null);
  const [watching, setWatching] = useState(false);
  const step = since && ps.login && Date.parse(ps.login.at) >= Date.parse(since.server) ? ps.login : null;
  const meaning = step ? LOGIN_STEP[step.outcome] : undefined;
  const loggingIn = since !== null && !connected;
  const quiet = since !== null && now - since.local >= 180_000;
  const running = state.running;
  const fetching = running !== null && !running.done;
  const fetchPs = async () => {
    setWatching(true);
    await api("/api/tenders/found/robot/fetch", { method: "POST", body: { portal: "ps" } });
    await queries.invalidateQueries({ queryKey: ["tenders", "found"] });
  };
  // While the log-in is open: look every 3 seconds for its next step.
  useEffect(() => {
    if (!loggingIn) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      void queries.invalidateQueries({ queryKey: ["tenders", "found"] });
    }, 3_000);
    return () => clearInterval(timer);
  }, [loggingIn, queries]);
  // A step that ends the log-in: stop waiting and say why.
  useEffect(() => {
    if (!since || connected || !step || !meaning?.final) return;
    setSince(null);
    setEnded({ tone: meaning.tone, title: meaning.title, said: step.detail ?? meaning.said ?? "" });
  }, [step?.at, step?.outcome]);
  // The log-in this press opened is saved: fetch.
  useEffect(() => {
    if (since === null || !connected) return;
    setSince(null);
    if (way === "off") {
      setEnded({ tone: "good", title: "PS-PhilGEPS is connected", said: "For everyone. The robot reads it at its next hourly run (Fetch now isn't set up on this server)." });
      return;
    }
    void action.run(fetchPs);
    // (once, when the log-in this press opened is saved)
  }, [connected, since]);
  const press = () =>
    void action.run(async () => {
      setEnded(null);
      setWatching(false);
      if (connected) return fetchPs();
      const { code, at } = await api<{ code: string; at: string }>("/api/tenders/found/ps/connect", { method: "POST", body: { purpose: "login" } });
      setSince({ server: at, local: Date.now() });
      setNow(Date.now());
      window.location.href = `bishnoi-ps-connect:start?code=${encodeURIComponent(code)}`;
    });
  const setUp = () =>
    void action.run(async () => {
      const { script } = await api<{ script: string }>("/api/tenders/found/ps/connect", { method: "POST", body: { purpose: "setup" } });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([script], { type: "application/octet-stream" }));
      link.download = "Set up PS-PhilGEPS log-in for Bishnoi One.cmd";
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    });
  const setUpLine = (
    <span className="mt-1 block">
      Nothing opened? This laptop needs a one-time setup (Windows with Google Chrome, about 5 minutes):{" "}
      <button type="button" disabled={action.busy} className="font-semibold text-sky-700 underline disabled:opacity-50" onClick={setUp}>
        Set up this laptop
      </button>
      , run the file it downloads, then press Fetch PS-PhilGEPS now again.
    </span>
  );
  const title = !connected
    ? "PS-PhilGEPS is not connected: this opens its log-in on this laptop first (tick the captcha), then fetches."
    : way === "off"
      ? "The robot can't be started from this server; it still runs by itself every hour."
      : running?.done
        ? "Fetched a few minutes ago; it can be pressed again 10 minutes after the last press."
        : `Reads PS-PhilGEPS now${way === "github" ? " (GitHub runs the robot)" : " (the robot runs on this computer)"}. It takes a few minutes.`;
  return (
    <div className="mt-2 space-y-2">
      <span className="flex flex-wrap items-center gap-2">
        <Button
          small
          variant="primary"
          title={title}
          disabled={action.busy || (loggingIn && !quiet) || (connected && (way === "off" || running !== null))}
          className="disabled:opacity-50"
          onClick={press}
        >
          {loggingIn && !quiet ? "Waiting for the log-in…" : fetching ? "Fetching…" : "Fetch PS-PhilGEPS now"}
        </Button>
        {fetching && running && (
          <span className="text-[12px] text-slate-600">
            started {running.by ? `by ${running.by} ` : ""}at {when(running.at)}
          </span>
        )}
        {!connected && !loggingIn && <span className="text-[12px] text-slate-500">Logs in first, from a team laptop with Google Chrome.</span>}
      </span>
      {state.failed && !fetching && connected && (
        <span className="block text-[12px] font-semibold text-rose-700">
          The last Fetch now ({when(state.failed.at)}) did not finish{state.failed.note ? `: ${state.failed.note}` : "."}
        </span>
      )}
      <Problem message={action.problem?.message} />
      {loggingIn &&
        (quiet ? (
          <StatusBox tone="warn" title="No log-in within 3 minutes" onClose={() => setSince(null)}>
            {meaning && step ? `The last step heard: ${meaning.title.toLowerCase()}${step.detail ? ` (${step.detail})` : ""}. ` : "Nothing was heard from this laptop. "}
            {setUpLine}
          </StatusBox>
        ) : meaning && step ? (
          <StatusBox tone={meaning.tone} title={meaning.title} onClose={() => setSince(null)}>
            {step.detail ?? meaning.said}
            {step.outcome === "rejected" && <span className="block text-slate-500">After 3 refusals the log-in stops so the account isn't locked.</span>}
          </StatusBox>
        ) : (
          <StatusBox tone="work" title="Opening the PS-PhilGEPS log-in on this laptop…" onClose={() => setSince(null)}>
            A Chrome window opens with the log-in filled in. If the browser asks whether to open the PS-PhilGEPS log-in, allow it.
            {now - since.local >= 20_000 && setUpLine}
          </StatusBox>
        ))}
      {ended && (
        <StatusBox tone={ended.tone} title={ended.title} onClose={() => setEnded(null)}>
          {ended.said}
          {ended.tone === "bad" && <span className="mt-1 block text-slate-500">Put it right, then press Fetch PS-PhilGEPS now again.</span>}
        </StatusBox>
      )}
      {watching && !loggingIn && !ended && <FetchStatus name="PS-PhilGEPS" state={state} runs={runs} stage={ps.stage} onClose={() => setWatching(false)} />}
    </div>
  );
}

/** Fetch now on one portal's card: that portal's robot runs at once instead of at the next hour (the
 *  bidding system's Sync button of that portal). While a press waits for its run the page looks again
 *  every 15 seconds (TenderFinderPage), and the status box at the bottom right follows it. */
function FetchNow({ way, portal, state, runs, blocked }: { way: FoundList["robot"]["fetch"]["way"]; portal: "philgeps" | "ps"; state: PortalFetchState; runs: FindRunRow[]; blocked?: string | null }) {
  const queries = useQueryClient();
  const action = useAction();
  const [watching, setWatching] = useState(false);
  const running = state.running;
  const waiting = running !== null && !running.done;
  const name = PORTAL[portal];
  const title =
    way === "off"
      ? "The robot can't be started from this server; it still runs by itself every hour."
      : blocked
        ? blocked
        : running?.done
          ? "Fetched a few minutes ago; it can be pressed again 10 minutes after the last press."
          : `Reads ${name} now${way === "github" ? " (GitHub runs the robot)" : " (the robot runs on this computer)"}. It takes a few minutes.`;
  return (
    <span className="mt-2 flex flex-col items-start">
      <span className="flex flex-wrap items-center gap-2">
        <Button
          small
          variant="primary"
          title={title}
          disabled={action.busy || way === "off" || Boolean(blocked) || running !== null}
          className="disabled:opacity-50"
          onClick={() =>
            void action.run(async () => {
              setWatching(true);
              await api("/api/tenders/found/robot/fetch", { method: "POST", body: { portal } });
              await queries.invalidateQueries({ queryKey: ["tenders", "found"] });
            })
          }
        >
          {waiting ? "Fetching…" : `Fetch ${name} now`}
        </Button>
        {waiting && running && (
          <span className="text-[12px] text-slate-600">
            started {running.by ? `by ${running.by} ` : ""}at {when(running.at)}
          </span>
        )}
      </span>
      {state.failed && !waiting && (
        <span className="mt-1 text-[12px] font-semibold text-rose-700">
          The last Fetch now ({when(state.failed.at)}) did not finish{state.failed.note ? `: ${state.failed.note}` : "."}
        </span>
      )}
      <Problem message={action.problem?.message} />
      {watching && <FetchStatus name={name} state={state} runs={runs} onClose={() => setWatching(false)} />}
    </span>
  );
}

/** The robot's last word, one card per portal (the developer, 25 Nov: "a separate connection of PhilGEPS
 *  and PS-PhilGEPS"): each with its own last read, what its log-in needs and its own Fetch now. The
 *  bridge's hand-overs from the bidding system (both portals) are a line of their own. */
function Robot({ robot }: { robot: FoundList["robot"] }) {
  const latest = robot.runs[0];
  // It runs every hour of the working day: a day with no word from it is worth a look.
  const hours = latest ? Math.floor((Date.now() - Date.parse(latest.at)) / 3_600_000) : 0;
  const quiet = hours >= 26 ? hours : null;
  const fed = robot.runs.filter((run) => run.trigger === "feed");
  const own = (source: "philgeps" | "ps") => robot.runs.filter((run) => run.source === source && run.trigger !== "feed");
  return (
    <section className={`${CARD} px-4 py-3 text-[13px]`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-slate-600">
          <b className="text-slate-900">Robot</b> reads both portals every hour from 6 AM to 5 PM.
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {!robot.ready ? (
            <span className="text-[12px] font-semibold text-amber-700" title="The robot has no way in on this server (its GitHub workflow is switched off and no key is set).">
              Not connected on this server
            </span>
          ) : (
            quiet !== null && <span className="text-[12px] font-semibold text-amber-700">No run for {quiet} hours</span>
          )}
        </span>
      </div>
      <div className="mt-2.5 grid gap-2.5 md:grid-cols-2">
        <PhilgepsCard runs={own("philgeps")} login={robot.login} fetch={<FetchNow way={robot.fetch.way} portal="philgeps" state={robot.fetch.philgeps} runs={own("philgeps")} />} />
        <PsCard
          runs={own("ps")}
          ps={robot.ps}
          fetch={<PsFetch way={robot.fetch.way} state={robot.fetch.ps} ps={robot.ps} runs={own("ps")} />}
        />
      </div>
      {fed[0] && (
        <p className="mt-2 text-[12px] text-slate-500">
          <b className="font-semibold">From the bidding system</b> (both portals, while it moves in): <RunLine run={fed[0]} />
        </p>
      )}
    </section>
  );
}

type FindRunRow = FoundList["robot"]["runs"][number];

function RunLine({ run }: { run: FindRunRow }) {
  return (
    <>
      {when(run.at)}
      {run.status === "failed" ? <span className="font-semibold text-rose-700"> · failed</span> : ""}
      {run.summary ? ` · ${run.summary}` : ""}
    </>
  );
}

/** One portal's card: its name and a pill for where it stands, its last read and what its log-in needs
 *  (only the last run: the earlier ones are not shown, the developer, 25 Nov). */
function PortalCard({ name, pill, runs, children }: { name: string; pill: ReactNode; runs: FindRunRow[]; children?: ReactNode }) {
  const [last] = runs;
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <b className="text-slate-900">{name}</b>
        {pill}
      </div>
      <p className="mt-1 text-[12px] text-slate-600">
        {last ? (
          <>
            Last read <RunLine run={last} />
          </>
        ) : (
          "Not read yet."
        )}
      </p>
      {children}
    </div>
  );
}

/** PS-PhilGEPS (philgeps.gov.ph): its log-in has a captcha, so a person connects it from a team laptop; the
 *  session then serves everyone until PS-PhilGEPS ends it. */
function PsCard({ runs, ps, fetch }: { runs: FindRunRow[]; ps: FoundList["robot"]["ps"]; fetch: ReactNode }) {
  const pill = ps.connected ? <Pill tone="good">Connected</Pill> : <Pill tone="warn">Not connected</Pill>;
  return (
    <PortalCard name="PS-PhilGEPS" pill={pill} runs={runs}>
      <p className={`mt-1 text-[12px] ${ps.connected ? "text-slate-500" : "text-amber-700"}`}>
        {ps.connected
          ? `Connected${ps.connectedAt ? ` since ${when(ps.connectedAt)}` : ""}${ps.status === "failed" && ps.error ? ` · the last Sync stopped: ${ps.error}` : ps.stage ? ` · ${ps.stage}` : ""}.`
          : "Its log-in has a captcha: Fetch PS-PhilGEPS now logs in first from this laptop (a person ticks it), then the log-in serves everyone (the robot reads it every hour) until PS-PhilGEPS ends it."}
      </p>
      {fetch}
    </PortalCard>
  );
}

/** The old PhilGEPS (notices.philgeps.gov.ph): its public list needs no log-in; the screened tenders'
 *  papers need the company's log-in (one session per account: the robot logs in once a run, then out). */
function PhilgepsCard({ runs, login, fetch }: { runs: FindRunRow[]; login: FoundList["robot"]["login"]; fetch: ReactNode }) {
  const queries = useQueryClient();
  const action = useAction();
  const pill =
    login.state === "refused" ? (
      <Pill tone="bad">Log-in refused</Pill>
    ) : runs[0]?.status === "failed" ? (
      <Pill tone="bad">Last read failed</Pill>
    ) : runs.length ? (
      <Pill tone="good">Last read OK</Pill>
    ) : (
      <Pill>Waiting</Pill>
    );
  return (
    <PortalCard name="PhilGEPS" pill={pill} runs={runs}>
      <p className="mt-1 text-[12px] text-slate-500">The old site: its public list needs no log-in. No new tenders since 1 Nov; its last ones close on 2 Dec.</p>
      {login.state === "refused" && (
        <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-900">
          <b>PhilGEPS refused the robot's log-in</b>
          {login.at ? ` (${when(login.at)})` : ""}
          {login.said ? `: ${login.said}` : "."} The papers of screened tenders wait. The robot does not send a refused password again by
          itself (that locks the account): once the password is put right where the robot keeps it,{" "}
          <button
            type="button"
            disabled={action.busy}
            className="font-semibold underline disabled:opacity-50"
            onClick={() =>
              void action.run(async () => {
                await api("/api/tenders/found/robot/login-again", { method: "POST", body: {} });
                await queries.invalidateQueries({ queryKey: ["tenders", "found"] });
              })
            }
          >
            let it try again
          </button>
          .
          <Problem message={action.problem?.message} />
        </div>
      )}
      {login.state === "busy" && (
        <p className="mt-1 text-[12px] text-amber-700">
          The account was in use on another computer{login.at ? ` at ${when(login.at)}` : ""}: the robot tries the papers again later.
        </p>
      )}
      {login.state === "never" && (
        <p className="mt-1 text-[12px] text-slate-500">Tender papers: not logged in yet (it needs the company's PhilGEPS log-in); screened tenders' papers wait for it.</p>
      )}
      {login.state === "ok" && login.at && <p className="mt-1 text-[12px] text-slate-500">Tender papers: last logged in and out {when(login.at)}.</p>}
      {fetch}
    </PortalCard>
  );
}

/** The medicines a person leaves out of the list (the bidding system's "Exclude products"): kept in this
 *  browser, as there, so they stay left out on the next visit. */
const LEFT_OUT_KEY = "tenderFinder.excludedProducts";
function readLeftOut(): string[] {
  try {
    const kept = JSON.parse(localStorage.getItem(LEFT_OUT_KEY) ?? "[]") as unknown;
    return Array.isArray(kept) ? kept.filter((one): one is string => typeof one === "string") : [];
  } catch {
    return [];
  }
}
function keepLeftOut(names: string[]): void {
  try {
    localStorage.setItem(LEFT_OUT_KEY, JSON.stringify(names));
  } catch {
    // A browser that keeps nothing: they stay left out for this visit only.
  }
}

const SORTS: [FoundSort, string][] = [
  ["latest", "Latest published"],
  ["oldest", "Oldest published"],
  ["closing", "Closing soonest"],
  ["budget", "Highest budget"],
];
const DOC_CHIPS: [FoundDocs, string][] = [
  ["all", "All"],
  ["with", "With documents"],
  ["pickup", "Pick-up only"],
  ["none", "No documents yet"],
];
const isoDay = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const shortDay = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" });

export function TenderFinderPage() {
  const queries = useQueryClient();
  const action = useAction();
  const [params, setParams] = useSearchParams();
  const asked = params.get("view");
  const view: FoundView = asked === "screened" || asked === "tenders" || asked === "all" ? asked : "opportunities";
  const q = params.get("q") ?? "";
  const ask = (key: string) => params.get(key) ?? "";
  const page = String(Math.max(1, Number(params.get("page")) || 1));
  const [typed, setTyped] = useState(q);
  const [leftOut, setLeftOut] = useState<string[]>(readLeftOut);
  // Another tab, search, filter or chip starts again from page 1.
  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) value ? next.set(key, value) : next.delete(key);
    if (!("page" in changes)) next.delete("page");
    setParams(next, { replace: true });
  };
  const goTo = (to: number) => {
    set({ page: to > 1 ? String(to) : "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const leaveOut = (names: string[]) => {
    setLeftOut(names);
    keepLeftOut(names);
    set({});
  };
  const sent = {
    view,
    q,
    source: ask("source"),
    molecule: ask("molecule"),
    type: ask("type"),
    docs: ask("docs"),
    sort: ask("sort"),
    dateOn: ask("dateOn"),
    from: ask("from"),
    to: ask("to"),
    size: ask("size"),
    page,
    exclude: leftOut.join(","),
  };
  const query = useQuery({
    queryKey: ["tenders", "found", sent],
    queryFn: () => api<FoundList>(`/api/tenders/found?${new URLSearchParams(Object.entries(sent).filter(([, value]) => value))}`),
    placeholderData: (before) => before,
    // While Fetch now waits for its run, look again every 15 seconds so the new tenders show by themselves.
    refetchInterval: (current) => {
      const fetch = current.state.data?.robot.fetch;
      const busy = [fetch?.philgeps, fetch?.ps].some((one) => one?.running && !one.running.done);
      return busy ? 15_000 : false;
    },
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the tenders found" />;
  const filtering = Boolean(sent.source || sent.molecule || sent.type || sent.from || sent.to);
  const stats = data.stats;
  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <PageHead
        title="Tender finder"
        sub="Found on PhilGEPS and PS-PhilGEPS for our medicines → screened by the team → made a tender"
        actions={
          <Link to="/tenders" className="inline-flex h-10 items-center rounded-[10px] border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            All tenders
          </Link>
        }
      />
      <Robot robot={data.robot} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Total opportunities" value={stats.listed.toLocaleString("en-PH")} sub={`of ${stats.ours.toLocaleString("en-PH")} asking for our products`} />
        <Tile
          label="Product matches"
          tone="good"
          value={stats.products.toLocaleString("en-PH")}
          sub={`of our products requested (${stats.productsAll.toLocaleString("en-PH")} in all)`}
        />
        <Tile label="Total ABC value" tone="info" value={shortPeso(stats.abc)} sub="approved budgets of the listed tenders" />
        <Tile
          label="Documents fetched"
          value={stats.files.toLocaleString("en-PH")}
          sub={`files of ${stats.withFiles.toLocaleString("en-PH")} of the ${stats.listed.toLocaleString("en-PH")} listed tenders`}
        />
      </div>
      <Tabs
        tabs={[
          { key: "opportunities" as const, label: "Opportunities", count: data.counts.opportunities },
          { key: "screened" as const, label: "Screened", count: data.counts.screened },
          { key: "tenders" as const, label: "Made tenders", count: data.counts.tenders },
          { key: "all" as const, label: "Everything found", count: data.counts.all },
        ]}
        value={data.view}
        onChange={(key) => set({ view: key === "opportunities" ? "" : key })}
      />
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Documents">
        {DOC_CHIPS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={data.docs === key}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold ${
              data.docs === key ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
            onClick={() => set({ docs: key === "all" ? "" : key })}
          >
            {label} <span className="text-slate-400">{data.docCounts[key].toLocaleString("en-PH")}</span>
          </button>
        ))}
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          set({ q: typed.trim() });
        }}
      >
        <label className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input
            className="field h-10 w-full pl-9"
            placeholder="Search reference no., title, agency name or molecule"
            aria-label="Search the tenders found"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onBlur={() => typed.trim() !== q && set({ q: typed.trim() })}
          />
        </label>
        <select className="field h-10 w-auto" aria-label="Portal" value={sent.source} onChange={(event) => set({ source: event.target.value })}>
          <option value="">Portal: Both</option>
          <option value="philgeps">PhilGEPS</option>
          <option value="ps">PS-PhilGEPS</option>
        </select>
        <select className="field h-10 w-auto max-w-56" aria-label="Our product" value={sent.molecule} onChange={(event) => set({ molecule: event.target.value })}>
          <option value="">Our product: All</option>
          {data.products.map((one) => (
            <option key={one.name} value={one.name}>
              {one.name} ({one.n})
            </option>
          ))}
        </select>
        <select className="field h-10 w-auto" aria-label="Type" value={sent.type} onChange={(event) => set({ type: event.target.value })}>
          <option value="">Type: All</option>
          {data.types.map((one) => (
            <option key={one.code} value={one.code}>
              {one.code} ({one.n})
            </option>
          ))}
        </select>
        <LeaveOut products={data.products} leftOut={leftOut} onChange={leaveOut} />
        <select className="field h-10 w-auto" aria-label="Sort" value={data.sort} onChange={(event) => set({ sort: event.target.value === "latest" ? "" : event.target.value })}>
          {SORTS.map(([key, label]) => (
            <option key={key} value={key}>
              Sort: {label}
            </option>
          ))}
        </select>
        <DateRange on={sent.dateOn === "closing" ? "closing" : "published"} from={sent.from} to={sent.to} onChange={(range) => set(range)} />
        {filtering && (
          <button type="button" className="text-[12.5px] font-semibold text-slate-600 underline" onClick={() => set({ source: "", molecule: "", type: "", dateOn: "", from: "", to: "" })}>
            Clear filters
          </button>
        )}
      </form>
      {leftOut.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-slate-600">
          Leaving out:
          {leftOut.map((name) => (
            <button
              key={name}
              type="button"
              className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-700 hover:bg-slate-50"
              onClick={() => leaveOut(leftOut.filter((one) => one !== name))}
            >
              {name} ×
            </button>
          ))}
        </p>
      )}
      <Problem message={action.problem?.message} />
      <section className={`${CARD} min-w-0 overflow-x-auto`}>
        {data.rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-slate-500">
            {filtering || q || data.docs !== "all" || leftOut.length
              ? "No tender matches the search and filters."
              : data.view === "opportunities"
                ? "No tender of ours found yet on either portal."
                : data.view === "screened"
                  ? "Nothing screened and waiting. Add a tender worth bidding on from Opportunities."
                  : data.view === "tenders"
                    ? "No found tender has been made a tender yet."
                    : "Nothing found yet."}
          </p>
        ) : (
          <table className="w-full min-w-[860px] text-left text-[13px]">
            <thead className="border-b border-slate-100 text-[11.5px] font-semibold text-slate-500">
              <tr>
                <th className="px-3 py-2.5 text-center">#</th>
                <th className="px-3 py-2.5">Ref No. &amp; Type</th>
                <th className="px-3 py-2.5">Procuring agency</th>
                <th className="px-3 py-2.5 text-right">Approved budget (ABC)</th>
                <th className="px-3 py-2.5">Published</th>
                <th className="px-3 py-2.5">Matched molecules</th>
                <th className="px-3 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.rows.map((found, at) => {
                const close = closing(found);
                const number = (data.page - 1) * data.pageSize + at + 1;
                return (
                  <tr key={found.id} className="align-top">
                    <td className="px-3 py-3 text-center">
                      <span
                        className={`inline-flex size-7 items-center justify-center rounded-full text-[11.5px] font-bold ${found.files ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}
                        title={found.files ? "Its papers are here" : "No papers yet"}
                      >
                        {number}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <Link to={`/tenders/finder/${found.id}`} className="font-semibold text-slate-900 hover:underline">
                        {found.refNo}
                      </Link>
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        <Pill>{PORTAL[found.source]}</Pill>
                        {found.type && (
                          <span title={[found.noticeType, found.procurementMode].filter(Boolean).join(" · ")}>
                            <Pill tone="info">{found.type}</Pill>
                          </span>
                        )}
                        <State found={found} />
                      </span>
                      <span className="mt-1 block text-[11.5px] text-slate-500">
                        {found.files
                          ? `${found.files} ${found.files === 1 ? "file" : "files"}`
                          : found.docsStatus === "pick-up"
                            ? "Pick-up only"
                            : "No documents yet"}
                      </span>
                    </td>
                    <td className="max-w-72 px-3 py-3">
                      <span className="line-clamp-2 font-semibold text-slate-800">{found.agency ?? found.title}</span>
                      {found.agency && <span className="mt-0.5 line-clamp-2 block text-[12px] text-slate-500">{found.title}</span>}
                      {found.agency && !found.agencyId && <span className="text-[11.5px] text-amber-700">not a customer yet</span>}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold whitespace-nowrap text-slate-900 tabular-nums">{found.abc ? peso(found.abc) : "—"}</td>
                    <td className="px-3 py-3 text-[12.5px] whitespace-nowrap text-slate-700">
                      {found.publishedOn ? dayLabel(found.publishedOn) : "—"}
                      <span className={`mt-0.5 block text-[11.5px] font-semibold ${close.tone}`}>{close.text}</span>
                    </td>
                    <td className="px-3 py-3">
                      <Molecules names={found.molecules} />
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <Link to={`/tenders/finder/${found.id}`} className="text-[12.5px] font-semibold text-emerald-700 hover:underline">
                        View details →
                      </Link>
                      {found.tenderId && (
                        <Link to={`/tenders/${found.tenderId}`} className="mt-1.5 block text-[12px] font-semibold text-slate-600 hover:underline">
                          Open {found.tenderCode}
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <PageNumbers page={data.page} pageSize={data.pageSize} total={data.total} onPage={goTo} onSize={(size) => set({ size: size === 25 ? "" : String(size) })} />
    </div>
  );
}

/** "Exclude products": our medicines, each with how many tenders ask for it; a checked one hides every
 *  tender asking for it. */
function LeaveOut({ products, leftOut, onChange }: { products: FoundList["products"]; leftOut: string[]; onChange: (names: string[]) => void }) {
  const [find, setFind] = useState("");
  const shown = products.filter((one) => one.name.toLowerCase().includes(find.trim().toLowerCase()));
  return (
    <details className="relative">
      <summary className="field flex h-10 cursor-pointer list-none items-center gap-1 text-[13px]">
        Exclude products{leftOut.length ? ` (${leftOut.length})` : ""}
      </summary>
      <div className={`${CARD} absolute z-30 mt-1 w-72 p-3 shadow-lg`}>
        <p className="text-[12px] text-slate-500">Checked products are left out: any tender asking for one of them is hidden.</p>
        <input className="field mt-2 h-9 w-full" placeholder="Find…" aria-label="Find a product" value={find} onChange={(event) => setFind(event.target.value)} />
        <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
          {shown.map((one) => (
            <li key={one.name}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={leftOut.includes(one.name)}
                  onChange={(event) => onChange(event.target.checked ? [...leftOut, one.name] : leftOut.filter((name) => name !== one.name))}
                />
                <span className="flex-1">{one.name}</span>
                <span className="text-[12px] text-slate-400">{one.n}</span>
              </label>
            </li>
          ))}
          {shown.length === 0 && <li className="px-1.5 py-1 text-[12px] text-slate-500">No product found.</li>}
        </ul>
        {leftOut.length > 0 && (
          <button type="button" className="mt-2 text-[12.5px] font-semibold text-slate-600 underline" onClick={() => onChange([])}>
            Clear
          </button>
        )}
      </div>
    </details>
  );
}

/** "Date range": on the published day or the closing day, from and to (both inclusive), with the bidding
 *  system's quick picks. */
function DateRange({ on, from, to, onChange }: { on: "published" | "closing"; from: string; to: string; onChange: (range: { dateOn: string; from: string; to: string }) => void }) {
  const [draft, setDraft] = useState({ on, from, to });
  const today = new Date();
  const ago = (days: number) => isoDay(new Date(today.getTime() - days * 86_400_000));
  const label = !from && !to ? "Any" : `${on === "closing" ? "Closing" : "Published"}: ${from ? shortDay(from) : "…"} – ${to ? shortDay(to) : "…"}`;
  const apply = (range: { on: "published" | "closing"; from: string; to: string }) => onChange({ dateOn: range.on === "closing" ? "closing" : "", from: range.from, to: range.to });
  return (
    <details className="relative" onToggle={(event) => event.currentTarget.open && setDraft({ on, from, to })}>
      <summary className="field flex h-10 cursor-pointer list-none items-center gap-1 text-[13px]">Date range: {label}</summary>
      <div className={`${CARD} absolute right-0 z-30 mt-1 w-80 space-y-2.5 p-3 shadow-lg`}>
        <div className="flex gap-1">
          {(["published", "closing"] as const).map((one) => (
            <button
              key={one}
              type="button"
              className={`h-8 flex-1 rounded-[10px] text-[12.5px] font-semibold ${draft.on === one ? "bg-emerald-600 text-white" : "border border-slate-300 text-slate-700"}`}
              onClick={() => setDraft({ ...draft, on: one })}
            >
              {one === "published" ? "Published" : "Closing"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {(
            [
              ["Last 7 days", ago(6)],
              ["Last 30 days", ago(29)],
              ["This month", `${isoDay(today).slice(0, 8)}01`],
            ] as const
          ).map(([name, start]) => (
            <button
              key={name}
              type="button"
              className="rounded-full border border-slate-200 px-2.5 py-1 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
              onClick={() => setDraft({ ...draft, from: start, to: isoDay(today) })}
            >
              {name}
            </button>
          ))}
        </div>
        <label className="block text-[12px] font-semibold text-slate-600">
          From
          <input type="date" className="field mt-1 h-9 w-full" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
        </label>
        <label className="block text-[12px] font-semibold text-slate-600">
          To
          <input type="date" className="field mt-1 h-9 w-full" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
        </label>
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="text-[12.5px] font-semibold text-slate-600 underline"
            onClick={(event) => {
              apply({ on: "published", from: "", to: "" });
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            Clear all
          </button>
          <Button
            small
            variant="primary"
            onClick={(event) => {
              apply(draft);
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            Done
          </Button>
        </div>
      </div>
    </details>
  );
}

/** The pages of a list by number: first, last, and the two either side of the one shown, with Previous
 *  and Next, which tenders this page holds, and how many rows a page shows (25, 50 or 100). */
function PageNumbers({ page, pageSize, total, onPage, onSize }: { page: number; pageSize: number; total: number; onPage: (page: number) => void; onSize: (size: number) => void }) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const shown = [...new Set([1, page - 2, page - 1, page, page + 1, page + 2, last])].filter((n) => n >= 1 && n <= last).sort((a, b) => a - b);
  const button = "inline-flex h-9 min-w-9 items-center justify-center rounded-[10px] px-2.5 text-[13px] font-semibold disabled:opacity-40";
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex items-center gap-3 text-[12px] text-slate-500">
        Showing {((page - 1) * pageSize + 1).toLocaleString("en-PH")}–{Math.min(total, page * pageSize).toLocaleString("en-PH")} of {total.toLocaleString("en-PH")}
        <label className="flex items-center gap-1.5">
          Rows per page
          <select className="field h-8 w-auto py-0 text-[12.5px]" value={pageSize} onChange={(event) => onSize(Number(event.target.value))}>
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </span>
      {last > 1 && (
        <span className="flex flex-wrap items-center gap-1">
          <button type="button" className={`${button} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`} disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft className="size-4" aria-hidden="true" /> Previous
          </button>
          {shown.map((n, at) => (
            <span key={n} className="flex items-center gap-1">
              {at > 0 && n - (shown[at - 1] ?? n) > 1 && <span className="px-1 text-slate-400">…</span>}
              <button
                type="button"
                aria-current={n === page ? "page" : undefined}
                className={`${button} ${n === page ? "bg-emerald-600 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                onClick={() => n !== page && onPage(n)}
              >
                {n}
              </button>
            </span>
          ))}
          <button type="button" className={`${button} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`} disabled={page >= last} onClick={() => onPage(page + 1)}>
            Next <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </span>
      )}
    </nav>
  );
}

type Draft = { on: boolean; medicineId: string; qty: string; price: string };

/** The join's form: the agency as a customer, the mode, and each line as our medicine, its pieces
 *  and our price for one. */
function MakeTenderDialog({ detail, onClose }: { detail: FoundDetail; onClose: () => void }) {
  const queries = useQueryClient();
  const navigate = useNavigate();
  const action = useAction();
  const { found } = detail;
  const [agencyId, setAgencyId] = useState<number>(found.agencyId ?? 0);
  const [search, setSearch] = useState("");
  const searched = useQuery({
    queryKey: ["customers", "agencies", search],
    queryFn: () => api<CustomerList>(`/api/customers?q=${encodeURIComponent(search)}&page=1`),
    enabled: search.trim().length >= 2,
  });
  const offered = [
    ...detail.agencies,
    ...(searched.data?.rows ?? [])
      .filter((row) => (row.kind === "government" || row.kind === "hospital") && !detail.agencies.some((one) => one.id === row.id))
      .slice(0, 8)
      .map((row) => ({ id: row.id, name: row.name, city: null as string | null })),
  ];
  const [mode, setMode] = useState<TenderMode>(detail.mode);
  const [title, setTitle] = useState(found.title);
  // A line with no medicine of ours to offer picks from the whole list.
  const catalogue = useQuery({
    queryKey: ["inventory", "medicines"],
    queryFn: () => api<Catalogue>("/api/inventory/medicines"),
    enabled: detail.lines.some((line) => line.candidates.length === 0),
  });
  const priceOf = (line: FoundLine, medicineId: string) => line.candidates.find((one) => String(one.id) === medicineId)?.price ?? null;
  const [drafts, setDrafts] = useState<Record<number, Draft>>(() =>
    Object.fromEntries(
      detail.lines.map((line) => {
        const medicineId = line.medicineId ? String(line.medicineId) : "";
        const price = medicineId ? priceOf(line, medicineId) : null;
        return [line.id, { on: Boolean(line.medicineId), medicineId, qty: line.qty && Number.isInteger(line.qty) ? String(line.qty) : "", price: price ? String(price / 100) : "" }];
      }),
    ),
  );
  const change = (line: FoundLine, changes: Partial<Draft>) => setDrafts((before) => ({ ...before, [line.id]: { ...(before[line.id] as Draft), ...changes } }));
  const picked = detail.lines.filter((line) => drafts[line.id]?.on);
  const total = picked.reduce((sum, line) => sum + (Number(drafts[line.id]?.qty) || 0) * toCentavos(drafts[line.id]?.price ?? ""), 0);
  const unfinished = picked.some((line) => !drafts[line.id]?.medicineId || !(Number(drafts[line.id]?.qty) > 0));
  return (
    <Dialog title="Make it a tender" sub={`${PORTAL[found.source]} ${found.refNo} · its price, papers, award and order are then kept on the tender`} onClose={onClose} busy={action.busy} wide>
      <div className="text-[12.5px] font-semibold text-slate-600">
        Buying agency: <span className="font-normal text-slate-500">{found.agency ?? "not read"}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {offered.map((one) => (
          <button
            key={one.id}
            type="button"
            onClick={() => setAgencyId(one.id)}
            className={`rounded-md px-2 py-1 text-[12px] ring-1 ${agencyId === one.id ? "bg-brand text-white ring-brand" : "text-slate-700 ring-slate-200"}`}
          >
            {one.name}
            {one.city ? ` · ${one.city}` : ""}
          </button>
        ))}
      </div>
      <input
        className="field mt-2 h-9 w-full"
        placeholder={offered.length ? "Another customer: type to search" : "No customer of this name: type to search the customers"}
        aria-label="Search the customers"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {!agencyId && (
        <p className="mt-1 text-[12px] text-amber-700">
          Pick the customer this agency is. Not in Customers yet?{" "}
          <Link to="/customers" className="font-semibold underline">
            Add it there
          </Link>{" "}
          first; the pick is remembered for this agency's other tenders.
        </p>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <label className="block text-[12.5px] font-semibold text-slate-600">
          What it buys
          <input className="field h-10 w-full" value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Mode
          <select className="field h-10 w-full" value={mode} onChange={(event) => setMode(event.target.value as TenderMode)}>
            {Object.entries(MODE).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-2 text-[12px] text-slate-500">
        ABC {found.abc ? peso(found.abc) : "not read"} · bids close {found.closingAt ? when(found.closingAt) : "not read"}
        {detail.prebidOn ? ` · pre-bid ${dayLabel(detail.prebidOn)}` : ""}
        {detail.openingOn ? ` · opening ${dayLabel(detail.openingOn)}` : ""}
      </p>
      <h4 className="mt-4 text-[12.5px] font-bold text-slate-900">Our bid, medicine by medicine</h4>
      {detail.lines.length === 0 ? (
        <p className="mt-1 text-[12.5px] text-slate-500">No line was read on this notice: add the medicines on the tender's page.</p>
      ) : (
        <ul className="mt-1 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {detail.lines.map((line) => {
            const draft = drafts[line.id] as Draft;
            const options = line.candidates.length ? line.candidates.map((one) => ({ id: one.id, name: one.name })) : (catalogue.data?.rows ?? []).map((m) => ({ id: m.id, name: `${m.name} ${m.strength ?? ""}`.trim() }));
            const above = line.abcUnit !== null && draft.price && toCentavos(draft.price) > line.abcUnit;
            return (
              <li key={line.id} className="grid gap-2 px-3 py-2 sm:grid-cols-[1.25rem_minmax(0,1fr)_12rem_6.5rem_7.5rem] sm:items-start">
                <input
                  type="checkbox"
                  className="mt-1.5 accent-emerald-600"
                  aria-label={`Bid for ${line.description}`}
                  checked={draft.on}
                  onChange={(event) => change(line, { on: event.target.checked })}
                />
                <span className="min-w-0 text-[12.5px] text-slate-800">
                  {line.description}
                  <span className="block text-[11.5px] text-slate-500">
                    asked: {line.qty !== null ? `${count(line.qty)} ${line.unit ?? ""}` : "quantity not read"}
                    {line.abcUnit !== null ? ` · ABC ${peso(line.abcUnit)} a piece` : ""}
                  </span>
                </span>
                <select
                  className="field h-9"
                  aria-label="Our medicine"
                  value={draft.medicineId}
                  onChange={(event) => {
                    const price = priceOf(line, event.target.value);
                    change(line, { medicineId: event.target.value, on: Boolean(event.target.value), ...(price && !draft.price ? { price: String(price / 100) } : {}) });
                  }}
                >
                  <option value="">Pick our medicine</option>
                  {options.map((one) => (
                    <option key={one.id} value={one.id}>
                      {one.name}
                    </option>
                  ))}
                </select>
                <input className="field h-9" inputMode="numeric" placeholder="Pieces" aria-label="Pieces" value={draft.qty} onChange={(event) => change(line, { qty: event.target.value })} />
                <span>
                  <input
                    className="field h-9 w-full"
                    inputMode="decimal"
                    placeholder="₱ a piece"
                    aria-label="Our price for one piece"
                    value={draft.price}
                    onChange={(event) => change(line, { price: event.target.value })}
                  />
                  {above && <span className="block text-[11px] font-semibold text-rose-700">above the ABC</span>}
                  {draft.on && !toCentavos(draft.price) && <span className="block text-[11px] text-amber-700">no price yet: put it on the tender</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-[12.5px] text-slate-600">
        Our bid so far <b className="text-slate-900">{peso(total)}</b>
        {found.abc ? (
          <span className={total > found.abc ? "font-semibold text-rose-700" : ""}>
            {" "}
            · {total > found.abc ? "above" : "within"} the ABC of {peso(found.abc)}
          </span>
        ) : null}
        . The prices can change on the tender until the price is approved.
      </p>
      <Problem message={action.problem?.message} />
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={onClose} disabled={action.busy}>
          Not now
        </Button>
        <Button
          variant="primary"
          disabled={action.busy || !agencyId || title.trim().length < 3 || unfinished}
          onClick={() =>
            void action.run(async () => {
              const made = await api<{ id: number }>(`/api/tenders/found/${found.id}/tender`, {
                method: "POST",
                body: {
                  agencyId,
                  mode,
                  title: title.trim(),
                  lines: picked.map((line) => {
                    const draft = drafts[line.id] as Draft;
                    return { lineId: line.id, medicineId: Number(draft.medicineId), qty: Number(draft.qty), unitPrice: toCentavos(draft.price) };
                  }),
                },
              });
              await queries.invalidateQueries({ queryKey: ["tenders"] });
              navigate(`/tenders/${made.id}`);
            })
          }
        >
          Make the tender
        </Button>
      </div>
    </Dialog>
  );
}

const PAPERS: Record<string, string> = {
  downloaded: "Downloaded",
  "needs-payment": "PhilGEPS asks a payment for these papers: the robot did not order them (it never pays)",
  "pick-up": "Only by pick-up at the agency",
  closed: "The notice is closed on PhilGEPS",
  "none-found": "PhilGEPS has no papers for this notice",
  "no-order-link": "The notice has no way to order its papers",
  "order-flow-changed": "PhilGEPS showed an unexpected page, so the robot stopped; it tries again",
};
const fileSize = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** The notice's papers: the bid documents the robot got from PhilGEPS (ordered there at no cost
 *  in the company's name, for screened notices), what it said, and what the bid data sheet says. */
function Papers({ found, papers, listed }: { found: FoundTender; papers: FoundPapers; listed: string[] }) {
  const waiting =
    found.source === "ps"
      ? "The robot gets its papers with the next PS-PhilGEPS reading (once PS-PhilGEPS is connected)."
      : !found.open
        ? "The notice is closed: its papers were not got."
        : found.screenedAt
          ? "Screened: the robot gets its papers from PhilGEPS on its next run (every hour, 6 am to 5 pm)."
          : "Add it to screened and the robot gets its papers from PhilGEPS (ordered there in the company's name, at no cost; it never pays).";
  return (
    <section className={`${CARD} p-4`}>
      <h3 className="text-sm font-bold text-slate-900">
        Its papers {papers.files.length > 0 && <span className="font-normal text-slate-400">· {papers.files.length}</span>}
      </h3>
      <p className={`mt-1 text-[12.5px] ${papers.status && papers.status !== "downloaded" ? "text-amber-800" : "text-slate-600"}`}>
        {papers.status ? `${PAPERS[papers.status] ?? papers.status}${papers.status === "downloaded" ? ` from ${PORTAL[found.source]}` : ""}` : waiting}
        {papers.checkedAt ? ` · looked at ${when(papers.checkedAt)}` : ""}
      </p>
      {papers.remark && papers.status === "downloaded" && <p className="text-[12px] text-slate-500">{papers.remark}</p>}
      {papers.files.length > 0 ? (
        <ul className="mt-2 space-y-1 text-[13px]">
          {papers.files.map((file) => (
            <li key={file.id} className="flex flex-wrap items-baseline justify-between gap-2">
              <a href={`/api/tenders/found/files/${file.id}`} className="min-w-0 font-semibold text-emerald-700 hover:underline">
                {file.name}
              </a>
              <span className="shrink-0 text-[11.5px] text-slate-500">
                {file.kind === "bulletin" ? "bid bulletin · " : ""}
                {fileSize(file.size)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        listed.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[12.5px] text-slate-700">
            {listed.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        )
      )}
      {papers.reading && <p className="mt-2 text-[12px] text-sky-800">Scanned pages are still being read: their lines come with the next runs.</p>}
      {papers.readNote && !papers.reading && <p className="mt-2 text-[12px] text-amber-800">{papers.readNote}</p>}
      {papers.accuracy !== null && papers.accuracy <= 70 && (
        <p className="mt-2 text-[12px] font-semibold text-amber-800">The reading may be off ({papers.accuracy}%): check the lines against the paper.</p>
      )}
      <div className="mt-3 border-t border-slate-100 pt-2">
        <h4 className="text-[12.5px] font-bold text-slate-800">Bid data sheet (from the documents)</h4>
        {papers.files.length === 0 && listed.length === 0 ? (
          <p className="mt-1 text-[12px] text-slate-500">No documents downloaded yet; the next reading orders and reads them.</p>
        ) : (
          <ul className="mt-1 space-y-1.5">
            {SHEET_ROWS.map(([key, label]) => {
              const said = papers.sheet.find((one) => one.key === key)?.said;
              return (
                <li key={key} className="text-[12.5px]">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-600">{label}</span>
                    {said ? <Pill tone="good">Found</Pill> : <Pill>Not found</Pill>}
                  </span>
                  {said && <span className="mt-0.5 block text-slate-800">{said}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

const SHEET_ROWS: [string, string][] = [
  ["prebid_conference", "Pre-bid conference"],
  ["bid_opening", "Bid opening"],
  ["bid_submission_deadline", "Submission deadline"],
  ["delivery_period", "Delivery period"],
  ["bid_validity", "Bid validity"],
  ["bid_security", "Bid security"],
];

/** The bidding system's "Bidding dates": each from the notice, else what its bid data sheet says (marked
 *  "from documents"), cut down to the date or the number of days as the team writes them. */
function BiddingDates({ found, papers }: { found: FoundDetail["found"]; papers: FoundPapers }) {
  const d = found.details;
  const sheet = (key: string) => papers.sheet.find((one) => one.key === key)?.said ?? null;
  const fromDocs = (value: string | null) => (value ? { value, docs: true } : null);
  const fromNotice = (value: string | null) => (value ? { value, docs: false } : null);
  const hasPapers = papers.files.length > 0 || d.documents.length > 0;
  const rows: [string, { value: string; docs: boolean } | null][] = [
    ["Pre-bid conference", fromDocs(bidDateText(sheet("prebid_conference"))) ?? fromNotice(d.preBid)],
    ["Bid opening", fromDocs(bidDateText(sheet("bid_opening"))) ?? fromNotice(d.bidOpening)],
    ["Submission deadline", fromDocs(bidDateText(sheet("bid_submission_deadline")))],
    ["Closing", fromNotice(found.closingAt ? when(found.closingAt) : null)],
    ["Delivery period", fromDocs(deliveryText(sheet("delivery_period"))) ?? fromNotice(d.deliveryPeriod)],
    ["Bid validity", fromDocs(sheet("bid_validity"))],
    ["Bid security", fromDocs(sheet("bid_security"))],
    ["Last updated", fromNotice(d.lastUpdated)],
  ];
  return (
    <section className={`${CARD} p-4`}>
      <h3 className="text-sm font-bold text-slate-900">Bidding dates</h3>
      <dl className="mt-2 divide-y divide-slate-100">
        {rows.map(([label, said]) => (
          <div key={label} className="grid grid-cols-[9.5rem_1fr] gap-2 py-1.5 text-[12.5px]">
            <dt className="text-slate-500">{label}</dt>
            <dd className="text-slate-800">
              {said ? (
                <>
                  {said.value}
                  {said.docs && (
                    <span className="ml-1.5 inline-block align-middle">
                      <Pill tone="good">from documents</Pill>
                    </span>
                  )}
                </>
              ) : (
                <span className="text-slate-400">{hasPapers ? "Not in the notice or its documents" : "Not on the notice page"}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The bidding system's "Fetched": when the robot first and last read this tender, and when its papers
 *  were last looked at. */
function Fetched({ found, papers }: { found: FoundDetail["found"]; papers: FoundPapers }) {
  const rows: [string, string | null][] = [
    ["First fetched", when(found.firstSeenAt)],
    ["Last fetched", when(found.seenAt)],
    ["Documents checked", papers.checkedAt ? when(papers.checkedAt) : null],
  ];
  return (
    <section className={`${CARD} p-4`}>
      <h3 className="text-sm font-bold text-slate-900">Fetched</h3>
      <dl className="mt-2 divide-y divide-slate-100">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[9.5rem_1fr] gap-2 py-1.5 text-[12.5px]">
            <dt className="text-slate-500">{label}</dt>
            <dd className={value ? "text-slate-800" : "text-slate-400"}>{value ?? "Not yet"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const EVENT: Record<string, string> = { screened: "Added to screened", unscreened: "Taken off screened", agency: "Its customer picked", tender: "Made a tender" };

export function FoundTenderPage() {
  const { id } = useParams();
  const queries = useQueryClient();
  const action = useAction();
  const [making, setMaking] = useState(false);
  const query = useQuery({ queryKey: ["tenders", "found", "one", id], queryFn: () => api<FoundDetail>(`/api/tenders/found/${id}`) });
  const data = query.data;
  if (!data) return <PageState query={query} what="the notice" />;
  const { found } = data;
  const close = closing(found);
  const d = found.details;
  const screen = (on: boolean) =>
    void action.run(async () => {
      await api(`/api/tenders/found/${found.id}/screen`, { method: "POST", body: { on } });
      await queries.invalidateQueries({ queryKey: ["tenders", "found"] });
    });
  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <PageHead
        title={found.title}
        sub={
          <>
            <Link to="/tenders/finder" className="font-semibold text-emerald-700 hover:underline">
              Tender finder
            </Link>{" "}
            · {found.agency ?? "agency not read"} · {PORTAL[found.source]} {found.refNo}
            {found.noticeType ? ` · ${found.noticeType}` : ""}
          </>
        }
        tags={<State found={found} />}
        actions={
          <div className="flex flex-wrap gap-2">
            {found.link && (
              <a
                href={found.link}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-slate-300 bg-white px-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                The notice on {PORTAL[found.source]} <ExternalLink className="size-3.5" />
              </a>
            )}
            {found.tenderId ? (
              <Link
                to={`/tenders/${found.tenderId}`}
                className="inline-flex h-8 items-center rounded-[10px] border border-emerald-300 bg-emerald-50 px-2.5 text-[13px] font-semibold text-emerald-800 hover:bg-emerald-100"
              >
                Open tender {found.tenderCode}
              </Link>
            ) : (
              <>
                <Button small variant={found.screenedAt ? undefined : "primary"} disabled={action.busy} onClick={() => screen(!found.screenedAt)}>
                  {found.screenedAt ? "✓ Screened · Remove" : "+ Add to Screened"}
                </Button>
                <Button small variant="primary" disabled={action.busy} onClick={() => setMaking(true)}>
                  Make it a tender
                </Button>
              </>
            )}
          </div>
        }
      />
      <Problem message={action.problem?.message} />
      {!found.open && !found.tenderId && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-[13px] text-amber-900">The bids for this one have closed ({found.closingAt ? when(found.closingAt) : ""}).</p>
      )}
      <Facts
        rows={[
          ["Procuring entity", found.agency],
          ["ABC", found.abc ? peso(found.abc) : "not read"],
          ["Published", found.publishedOn ? dayLabel(found.publishedOn) : null],
          ["Bids close", <span key="close" className={close.tone}>{close.text}</span>],
          ["Notice type", found.noticeType],
          ["Mode of procurement", found.procurementMode],
          ["Solicitation no.", d.solicitationNo],
          ["Classification", d.classification],
          ["Area of delivery", d.areaOfDelivery],
          ["On the portal", d.status],
          ["Customer", found.customer ?? (found.agency ? "not a customer yet" : null)],
          ["Screened by", found.screenedBy && found.screenedAt ? `${found.screenedBy} · ${when(found.screenedAt)}` : null],
        ]}
      />
      <section className={`${CARD} p-4`}>
        <h3 className="text-sm font-bold text-slate-900">
          Our products <span className="font-normal text-slate-400">· {found.molecules.length}</span>
        </h3>
        <div className="mt-2">{found.molecules.length ? <Molecules names={found.molecules} /> : <span className="text-[12.5px] text-slate-500">None named yet{found.source === "ps" ? " (on PS-PhilGEPS's Bid Match; its papers name them once read)" : ""}.</span>}</div>
      </section>
      <div className="grid gap-3 lg:grid-cols-2">
        <BiddingDates found={found} papers={data.papers} />
        <Fetched found={found} papers={data.papers} />
      </div>
      <section className={`${CARD} min-w-0 overflow-x-auto`}>
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
          What it asks for <span className="font-normal text-slate-400">· {data.lines.length} {data.lines.length === 1 ? "line" : "lines"} of ours</span>
        </h3>
        {data.lines.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-slate-500">No line of ours was read on this notice{found.molecules.length ? " yet (its papers may hold them)" : ""}.</p>
        ) : (
          <table className="w-full min-w-[40rem] text-[13px]">
            <thead>
              <tr className="text-left text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">
                <th className="px-4 py-2">#</th>
                <th className="px-3 py-2">As written</th>
                <th className="px-3 py-2 text-right">Quantity</th>
                <th className="px-3 py-2 text-right">ABC a piece</th>
                <th className="px-3 py-2 text-right">ABC of the line</th>
                <th className="px-3 py-2">Our medicine</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.lines.map((line, index) => (
                <tr key={line.id} className="align-top">
                  <td className="px-4 py-2 text-slate-500 tabular-nums">{line.itemNo ?? index + 1}</td>
                  <td className="px-3 py-2 text-slate-900">
                    {line.description}
                    {line.origin === "papers" && <span className="ml-1.5 rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-800">read in the papers</span>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{line.qty !== null ? `${count(line.qty)} ${line.unit ?? ""}` : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{line.abcUnit !== null ? peso(line.abcUnit) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{line.abcTotal !== null ? peso(line.abcTotal) : "—"}</td>
                  <td className="px-3 py-2">
                    {line.medicine ? (
                      <span className="font-semibold text-emerald-800">{line.medicine}</span>
                    ) : (
                      <span className="text-[12px] text-amber-700">
                        {line.candidates.length ? `Ours by molecule; we keep ${line.candidates.map((one) => one.name).join(", ")}: picked when it is made a tender` : "Not matched: picked when it is made a tender"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <div className="grid gap-3 lg:grid-cols-2">
        {(d.contactName || d.contactInfo.length > 0) && (
          <section className={`${CARD} p-4`}>
            <h3 className="text-sm font-bold text-slate-900">Contact at the agency</h3>
            <p className="mt-1 text-[13px] font-semibold text-slate-800">{d.contactName}</p>
            {d.contactInfo.map((line) => (
              <p key={line} className="text-[12.5px] text-slate-600">
                {line}
              </p>
            ))}
          </section>
        )}
        <Papers found={found} papers={data.papers} listed={d.documents} />
        {d.supplements.length > 0 && (
          <section className={`${CARD} p-4`}>
            <h3 className="text-sm font-bold text-slate-900">Bid bulletins and addenda</h3>
            <ul className="mt-1 space-y-0.5 text-[12.5px] text-slate-700">
              {d.supplements.map((one) => (
                <li key={`${one.no}-${one.title}`}>
                  {one.no}. {one.title}
                  <span className="text-slate-500">
                    {one.type ? ` · ${one.type}` : ""}
                    {one.published ? ` · ${dayLabel(one.published)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {found.itemsText && (
        <details className={`${CARD} p-4`}>
          <summary className="cursor-pointer text-sm font-bold text-slate-900">The notice's own text</summary>
          <pre className="mt-2 max-h-96 overflow-auto text-[12px] leading-relaxed whitespace-pre-wrap text-slate-700">{found.itemsText}</pre>
        </details>
      )}
      <section className={`${CARD} p-4`}>
        <h3 className="text-sm font-bold text-slate-900">History</h3>
        <ul className="mt-2 space-y-1 text-[12.5px] text-slate-600">
          <li>{when(found.firstSeenAt)} · <b>Found</b> by the robot on {PORTAL[found.source]}</li>
          {data.events.map((event) => (
            <li key={`${event.at}-${event.what}`}>
              {when(event.at)} · <b>{EVENT[event.what] ?? event.what}</b> by {event.by}
              {event.note ? ` · ${event.note}` : ""}
            </li>
          ))}
        </ul>
      </section>
      {making && <MakeTenderDialog detail={data} onClose={() => setMaking(false)} />}
    </div>
  );
}
