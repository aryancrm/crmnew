// The tender finder inside the CRM (docs/PLAN.md 24; Aryan, 23 Nov: "one CRM, not two"): what the
// robot found on PhilGEPS and PS-PhilGEPS for our medicines (New), the team's pick (Screened), the
// ones made tenders, and everything found; a notice's own page with what it asks line by line;
// and the join: Make it a tender, after which the tender's own page takes over (tenders.tsx).

import type { Catalogue, CustomerList, FoundDetail, FoundLine, FoundList, FoundPapers, FoundTender, FoundView, TenderMode } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, ExternalLink, Loader2, Search, X } from "lucide-react";
import { createPortal } from "react-dom";
import { type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { shortPeso } from "../ceo";
import { Button, CARD, dayLabel, Dialog, Facts, PageHead, PageState, Pill, Problem, peso, Tabs, useAction } from "../ui";

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

function State({ found }: { found: FoundTender }) {
  if (found.tenderId) return <Pill tone="good">Tender {found.tenderCode}</Pill>;
  if (found.screenedAt) return <Pill tone="info">Screened</Pill>;
  if (!found.open) return <Pill>Closed</Pill>;
  return found.molecules.length ? <Pill tone="brand">New</Pill> : <Pill>Not ours</Pill>;
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

/** One portal's card: its name and a pill for where it stands, its last read, what its log-in needs,
 *  and its earlier runs folded under. */
function PortalCard({ name, pill, runs, children }: { name: string; pill: ReactNode; runs: FindRunRow[]; children?: ReactNode }) {
  const [last, ...earlier] = runs;
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
      {earlier.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[12px] font-semibold text-slate-500">Earlier runs</summary>
          <ul className="mt-1 space-y-0.5 text-[12px] text-slate-600">
            {earlier.map((run) => (
              <li key={run.id}>
                <RunLine run={run} />
              </li>
            ))}
          </ul>
        </details>
      )}
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

export function TenderFinderPage() {
  const queries = useQueryClient();
  const action = useAction();
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") ?? "new") as FoundView;
  const q = params.get("q") ?? "";
  const source = params.get("source") ?? "";
  const molecule = params.get("molecule") ?? "";
  const [typed, setTyped] = useState(q);
  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) value ? next.set(key, value) : next.delete(key);
    setParams(next, { replace: true });
  };
  const query = useQuery({
    queryKey: ["tenders", "found", view, q, source, molecule],
    queryFn: () => api<FoundList>(`/api/tenders/found?${new URLSearchParams({ view, q, source, molecule })}`),
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
  const screen = (found: FoundTender, on: boolean) =>
    void action.run(async () => {
      await api(`/api/tenders/found/${found.id}/screen`, { method: "POST", body: { on } });
      await queries.invalidateQueries({ queryKey: ["tenders", "found"] });
    });
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
      <Tabs
        tabs={[
          { key: "new" as const, label: "New", count: data.counts.new },
          { key: "screened" as const, label: "Screened", count: data.counts.screened },
          { key: "tenders" as const, label: "Made tenders", count: data.counts.tenders },
          { key: "all" as const, label: "Everything found", count: data.counts.all },
        ]}
        value={data.view}
        onChange={(key) => set({ view: key === "new" ? "" : key })}
      />
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
            placeholder="Search: what it buys, the agency, the reference, a medicine"
            aria-label="Search the tenders found"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onBlur={() => typed.trim() !== q && set({ q: typed.trim() })}
          />
        </label>
        <select className="field h-10 w-auto" aria-label="Portal" value={source} onChange={(event) => set({ source: event.target.value })}>
          <option value="">Both portals</option>
          <option value="philgeps">PhilGEPS</option>
          <option value="ps">PS-PhilGEPS</option>
        </select>
        <select className="field h-10 w-auto max-w-56" aria-label="Our medicine" value={molecule} onChange={(event) => set({ molecule: event.target.value })}>
          <option value="">Every medicine of ours</option>
          {data.molecules.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </form>
      <Problem message={action.problem?.message} />
      <section className={`${CARD} min-w-0`}>
        {data.rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-slate-500">
            {data.view === "new"
              ? "Nothing new: every open tender for our medicines is screened, made a tender, or closed."
              : data.view === "screened"
                ? "Nothing screened and waiting. Add a tender worth bidding on from New."
                : data.view === "tenders"
                  ? "No found tender has been made a tender yet."
                  : "Nothing found yet."}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.rows.map((found) => {
              const close = closing(found);
              return (
                <li key={found.id} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-4 py-3 text-[13px]">
                  <div className="min-w-0 flex-1 basis-80">
                    <Link to={`/tenders/finder/${found.id}`} className="font-semibold text-slate-900 hover:underline">
                      {found.title}
                    </Link>
                    <span className="block text-[12px] text-slate-600">
                      {found.agency ?? "agency not read"}
                      {found.agency && !found.agencyId ? <span className="text-amber-700"> · not a customer yet</span> : ""}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-slate-500">
                      <State found={found} />
                      {PORTAL[found.source]} {found.refNo}
                      {found.noticeType ? ` · ${found.noticeType}` : found.procurementMode ? ` · ${found.procurementMode}` : ""}
                      {found.publishedOn ? ` · published ${dayLabel(found.publishedOn)}` : ""}
                    </span>
                    <span className="mt-1.5 block">
                      <Molecules names={found.molecules} />
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                    <span className="text-[15px] font-bold text-slate-900 tabular-nums">{found.abc ? shortPeso(found.abc) : "ABC not read"}</span>
                    <span className={`text-[12px] font-semibold ${close.tone}`}>{close.text}</span>
                    <span className="mt-1">
                      {found.tenderId ? (
                        <Link to={`/tenders/${found.tenderId}`} className="text-[12.5px] font-semibold text-emerald-700 hover:underline">
                          Open {found.tenderCode}
                        </Link>
                      ) : found.screenedAt ? (
                        <Link to={`/tenders/finder/${found.id}`} className="text-[12.5px] font-semibold text-emerald-700 hover:underline">
                          Make it a tender
                        </Link>
                      ) : (
                        <Button small disabled={action.busy} onClick={() => screen(found, true)}>
                          Add to screened
                        </Button>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {data.rows.length >= 300 && <p className="text-[12px] text-slate-500">The first 300 are shown: search or pick a medicine to narrow them.</p>}
    </div>
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
      {papers.sheet.length > 0 && (
        <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-2">
          {papers.sheet.map((one) => (
            <div key={one.label}>
              <dt className="text-[11.5px] font-semibold text-slate-500">{one.label} (as the papers say)</dt>
              <dd className="text-[12.5px] text-slate-800">{one.said}</dd>
            </div>
          ))}
        </dl>
      )}
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
                <Button small disabled={action.busy} onClick={() => screen(!found.screenedAt)}>
                  {found.screenedAt ? "Take off screened" : "Add to screened"}
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
          ["ABC", found.abc ? peso(found.abc) : "not read"],
          ["Bids close", <span key="close" className={close.tone}>{close.text}</span>],
          ["Published", found.publishedOn ? dayLabel(found.publishedOn) : null],
          ["Pre-bid conference", d.preBid],
          ["Bid opening", d.bidOpening],
          ["Mode", found.procurementMode],
          ["Delivery", [d.areaOfDelivery, d.deliveryPeriod].filter(Boolean).join(" · ")],
          ["Solicitation no.", d.solicitationNo],
          ["On the portal", d.status],
          ["Customer", found.customer ?? (found.agency ? "not a customer yet" : null)],
          ["Screened by", found.screenedBy && found.screenedAt ? `${found.screenedBy} · ${when(found.screenedAt)}` : null],
        ]}
      />
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
