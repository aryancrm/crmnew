// Bishnoi One's company portal (the sign-in page), as an app launcher (Aryan, 18 Nov): a tile per
// workspace; any tile opens the same sign-in (the person's own login ID and password), and each
// person's own login decides what opens inside. Only a look: permissions and the pages are unchanged.

import "@fontsource-variable/inter";
import type { Me, SignInAnswer } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CircleAlert, Eye, EyeOff, LoaderCircle, Search } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiFailure, api } from "../api";
import { ME, rememberPerson, returnTo, useMe } from "../auth";
import { About } from "../portal/about";
import { DevUserPicker } from "./dev-user-picker";
import { markActive } from "./idle";
import { DepartmentMark, DepartmentPanel } from "../portal/department-side";
import { TILE_GLOW, TILE_ICONS } from "../portal/tiles";
import { lastWorkspace, rememberWorkspace, type Workspace, WORKSPACES, workspaceOf } from "../workspaces";

/** The sign-in: the departments, then the one picked (Aryan, 21 Nov: no other way in; the old
 *  "Log in with ID and password" page is gone, so every session is opened for a department). */
export function Login() {
  return <Launcher />;
}

function Launcher() {
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const { dept } = useParams();
  const [params] = useSearchParams();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  // The tile pressed opens its department's page, the sign-in below it (the login decides what
  // opens inside, as always).
  // Its address is /login/<key>. The older /login?dept=<key> is still read, then rewritten.
  const asked = (dept ?? params.get("dept"))?.toLowerCase();
  const picked = WORKSPACES.find((one) => one.key === asked) ?? null;
  const address = loginPath(picked?.key);
  const [find, setFind] = useState("");
  const last = lastWorkspace();
  const open = (key: string | null) =>
    navigate(loginPath(key), { state: location.state });

  useEffect(() => {
    if (!picked) return;
    window.scrollTo({ top: 0 });
    const close = (event: KeyboardEvent) => event.key === "Escape" && open(null);
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
    // biome-ignore lint/correctness/useExhaustiveDependencies: on the department changing only
  }, [picked?.key]);

  if (me.data) return <Navigate to={landing(me.data.role, picked, returnTo(me.data.id, from))} replace />;
  // An old link, an unknown department or other capitals: the one right address, without a step back to the wrong one.
  if (location.pathname !== address || params.has("dept"))
    return <Navigate to={{ pathname: address, hash: location.hash }} state={location.state} replace />;

  const words = find.trim().toLowerCase();
  const shownTiles = WORKSPACES.filter(
    (one) => !words || `${one.label} ${one.about}`.toLowerCase().includes(words),
  );

  return (
    <main className="relative isolate overflow-x-hidden bg-[#f6f7fb] font-[Inter_Variable,Inter,sans-serif] text-[#1f2733]">
      {/* Soft colour behind the glass, faded, one layer down the whole page so the sections run on. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-20 overflow-hidden">
        <div className="absolute -top-40 -left-32 size-[34rem] rounded-full bg-[#ffd9c2] opacity-60 blur-[120px]" />
        <div className="absolute top-[33vh] -right-40 size-[36rem] rounded-full bg-[#cfe8d8] opacity-60 blur-[120px]" />
        <div className="absolute top-[calc(100vh-20rem)] left-1/3 size-[32rem] rounded-full bg-[#dcd6ff] opacity-50 blur-[120px]" />
        <div className="absolute top-[calc(100vh+16rem)] -right-48 size-[34rem] rounded-full bg-[#ffd9c2] opacity-50 blur-[130px]" />
        <div className="absolute top-[calc(100vh+38rem)] -left-48 size-[34rem] rounded-full bg-[#cfe8d8] opacity-50 blur-[130px]" />
        <div className="absolute bottom-[44rem] -left-48 size-[34rem] rounded-full bg-[#ffd9c2] opacity-50 blur-[130px]" />
        <div className="absolute bottom-[24rem] -right-48 size-[34rem] rounded-full bg-[#cfe8d8] opacity-50 blur-[130px]" />
        <div className="absolute bottom-0 left-1/3 size-[32rem] rounded-full bg-[#dcd6ff] opacity-45 blur-[130px]" />
      </div>
      {picked ? (
        // A split screen (Aryan, 21 Nov, after a sign-in screen he liked): the department's panel on
        // the left, tinted in its colour with its icon large; the form alone on white on the right.
        // Phones: the form first, the panel below it.
        <div className="relative z-10 flex min-h-dvh flex-col bg-white lg:flex-row">
          <aside
            className="order-2 flex flex-col px-6 py-10 lg:order-1 lg:w-[46%] lg:px-12 lg:py-8"
            style={{ background: `linear-gradient(160deg, ${TILE_GLOW[picked.key] ?? "#f36b21"}14, #f6f5fb 55%, ${TILE_GLOW[picked.key] ?? "#f36b21"}0d)` }}
          >
            <Link to={loginPath()} state={location.state} className={`${HOME_LINK} hidden self-start lg:flex`}>
              <img src="/brand/bishnoi-one-mark.png" alt="" className="size-8" />
              <span className="text-[18px] font-semibold tracking-[-0.03em]">Bishnoi One</span>
            </Link>
            <div className="flex flex-1 items-center py-6">
              <DepartmentPanel workspace={picked} />
            </div>
          </aside>
          <section className="order-1 flex flex-1 flex-col px-6 py-5 lg:order-2 lg:px-12 lg:py-8" aria-label={`Sign in to ${picked.label}`}>
            <div className="flex items-center justify-between gap-3">
              <Link to={loginPath()} state={location.state} className={`${HOME_LINK} flex lg:invisible`}>
                <img src="/brand/bishnoi-one-mark.png" alt="" className="size-7" />
                <span className="text-[17px] font-semibold tracking-[-0.03em]">Bishnoi One</span>
              </Link>
              <span className="flex items-center gap-3">
                <span className="hidden text-[13px] text-[#7a8394] sm:inline">Wrong department?</span>
                <button
                  type="button"
                  onClick={() => open(null)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#d5d9e1] px-4 text-[12px] font-semibold tracking-[0.04em] text-[#3c4452] uppercase transition-colors hover:border-[#f36b21] hover:text-[#c2410c]"
                >
                  <ArrowLeft className="size-3.5" aria-hidden="true" /> All departments
                </button>
              </span>
            </div>
            <div className="flex flex-1 justify-center pt-8 pb-10 lg:items-center lg:py-10">
              <div className="w-full max-w-[26rem]">
                <div className="mb-5 lg:hidden">
                  <DepartmentMark workspace={picked} />
                </div>
                <SignIn workspace={picked} from={from} />
              </div>
            </div>
          </section>
        </div>
      ) : (
        <>
      {/* The first screen: the launcher, whole in the window. */}
      <div className="relative isolate flex min-h-dvh flex-col overflow-hidden md:h-dvh">
      <Orbits />

      <header className="mx-auto flex w-[min(1180px,calc(100%-32px))] shrink-0 items-center gap-4 py-5">
        {/* Already home, so it starts the page afresh. Named here: on phones only the mark shows. */}
        <Link
          to={loginPath()}
          state={location.state}
          aria-label="Bishnoi One"
          onClick={(event) => {
            // Ctrl, Cmd or Shift opens another tab or window: this one stays as it is.
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            setFind("");
            window.scrollTo({ top: 0 });
          }}
          className={`${HOME_LINK} flex min-w-11 shrink-0 justify-center`}
        >
          <img src="/brand/bishnoi-one-mark.png" alt="" className="size-10" />
          <span className="hidden text-[22px] font-semibold tracking-[-0.03em] sm:inline">Bishnoi One</span>
        </Link>
        <label className="mx-auto flex h-12 w-full max-w-md min-w-0 items-center gap-3 rounded-2xl border border-white/80 bg-white/70 px-4 shadow-[0_8px_30px_-12px_rgba(20,30,50,0.18)] backdrop-blur-xl transition focus-within:bg-white/90 focus-within:shadow-[0_12px_36px_-12px_rgba(20,30,50,0.26)]">
          <Search className="size-5 text-[#f36b21]" aria-hidden="true" />
          <input
            value={find}
            onChange={(event) => setFind(event.target.value)}
            placeholder="Search workspaces"
            aria-label="Search workspaces"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#7a8394] focus:outline-none focus-visible:outline-none"
          />
        </label>
        <span className="hidden w-[150px] shrink-0 sm:block" aria-hidden="true" />
      </header>

      {/* A word on what this is. */}
      <div className="mx-auto w-[min(1000px,calc(100%-32px))] shrink-0 pt-[clamp(0.5rem,3vh,2.5rem)] text-center">
        <p className="text-[11px] font-semibold tracking-[0.22em] text-[#c2410c] uppercase">Bishnoi One · Company portal</p>
        <h1 className="mt-2 text-[clamp(26px,4.2vh,44px)] leading-tight font-semibold tracking-[-0.035em]">
          One company. <span className="text-[#f36b21]">Every department</span>, <span className="text-[#1f9d55]">one place</span>.
        </h1>
        <p className="mx-auto mt-2 max-w-lg text-[clamp(13px,1.8vh,15px)] text-[#5b6472]">
          Pick your workspace and sign in as yourself. Sales, approvals, money, stock, dispatch and people work from the
          same records.
        </p>
      </div>

      {/* The tiles; every one opens the same sign-in. */}
      <section aria-label="Workspaces" className="mx-auto flex w-[min(1100px,calc(100%-32px))] flex-1 items-center py-[clamp(1rem,4vh,3rem)]">
        <ul className="mx-auto flex max-w-[60rem] flex-wrap justify-center gap-x-[clamp(1rem,2.4vw,2.25rem)] gap-y-[clamp(1rem,3.2vh,2.25rem)]">
          {shownTiles.map((one) => {
            const Icon = TILE_ICONS[one.key];
            return (
              <li key={one.key} className="flex w-[clamp(6.5rem,13vh,8.5rem)] justify-center">
                <button type="button" onClick={() => open(one.key)} className="group flex flex-col items-center gap-2.5 focus-visible:outline-none">
                  <span className="relative grid size-[clamp(4.75rem,12vh,7rem)] place-items-center">
                    {/* The tile's own colour, faded, behind the glass. */}
                    <span
                      aria-hidden="true"
                      className="absolute inset-3 rounded-[2rem] opacity-25 blur-2xl transition-opacity duration-300 group-hover:opacity-45"
                      style={{ background: TILE_GLOW[one.key] }}
                    />
                    <span className="relative grid size-[clamp(4.75rem,12vh,7rem)] place-items-center rounded-[2rem] border border-white/90 bg-white/75 shadow-[0_18px_40px_-18px_rgba(20,30,50,0.28),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl transition duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_26px_50px_-20px_rgba(20,30,50,0.35)] group-focus-visible:ring-4 group-focus-visible:ring-[#f36b21]/30">
                      <span className="size-[56%] transition-transform duration-300 group-hover:scale-105">{Icon && <Icon />}</span>
                      {last === one.key && <span className="absolute top-3 right-3 size-2.5 rounded-full bg-[#f36b21] ring-2 ring-white" title="Last used" />}
                    </span>
                  </span>
                  <span className="text-[15px] font-medium text-[#3c4452]">{one.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {!shownTiles.length && <p className="text-center text-sm text-[#7a8394]">No workspace by that name.</p>}
      </section>

      <footer className="mx-auto flex w-[min(1180px,calc(100%-32px))] shrink-0 flex-wrap items-center justify-between gap-3 pb-5">
        <a href="#about" className="text-xs font-medium text-[#5b6472] hover:text-[#c2410c]">What is Bishnoi One? ↓</a>
        <span className="text-xs text-[#5b6472]">Need access? Contact your administrator.</span>
      </footer>
      </div>

          <About />

        </>
      )}
    </main>
  );
}

/** The sign-in's address: the launcher, or one department's page. */
const loginPath = (key?: string | null) => (key ? `/login/${key}` : "/login");

/** The logo, on the portal and on a department's page, goes home (Jakob); 44px to press (Fitts). */
const HOME_LINK =
  "min-h-11 items-center gap-2.5 rounded-lg transition-colors hover:text-[#c2410c] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f36b21]";

/** Where a person lands: the Books tile opens Books for those who keep the books. */
const landing = (role: string, picked: Workspace | null, from: string) =>
  picked?.key === "books" && ["finance", "ceo", "admin"].includes(role) ? "/books/home" : from;

/** The sign-in, the same for every department: login ID and password, as always. */
function SignIn({ workspace, from }: { workspace: Workspace; from: string }) {
  const queries = useQueryClient();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; field?: string } | null>(null);
  const picked = workspace;
  const ids = useId();
  const [capsLock, setCapsLock] = useState(false);
  const submitButton = useRef<HTMLButtonElement>(null);
  // Two-step sign-in: set once the password was right, until the code signs them in.
  const [ticket, setTicket] = useState<string | null>(null);
  useEffect(() => setTicket(null), [workspace.key]);
  const field =
    "h-12 w-full rounded-xl border border-[#d5d9e1] bg-white px-3.5 text-[15px] text-[#1f2733] outline-none transition-[border-color,box-shadow] placeholder:text-[#6b7380] hover:border-[#b9bfcb] focus:border-[#f36b21] focus:ring-4 focus:ring-[#f36b21]/15 disabled:bg-[#f6f7f9] aria-[invalid=true]:border-rose-500 aria-[invalid=true]:ring-rose-500/15";
  const label = "text-[13px] font-semibold text-[#1f2733]";

  /** Signed in: the person's own landing, as always. */
  const signedInAs = (signedIn: Me) => {
    const back = returnTo(signedIn.id, from);
    markActive();
    queries.setQueryData(ME, signedIn);
    rememberWorkspace(workspaceOf(signedIn).key);
    navigate(landing(signedIn.role, workspace, back), { replace: true });
    rememberPerson(signedIn.id);
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const answer = await api<SignInAnswer>("/api/auth/login", { body: { email, password, workspace: picked.key } });
      if (answer.twoStep) {
        // The password has done its part: it isn't kept on the screen.
        setPassword("");
        setShown(false);
        setTicket(answer.ticket);
      } else signedInAs(answer.me);
    } catch (error) {
      setProblem(error instanceof ApiFailure ? { message: error.message, field: error.field } : { message: "Couldn't sign in. Try again." });
    } finally {
      setBusy(false);
    }
  }

  // Each error sits under the field it is about (proximity); one about neither, under the password.
  const idError = problem?.field === "email" ? problem.message : null;
  const passwordError = problem && !idError ? problem.message : null;

  if (ticket)
    return (
      <CodeStep
        ticket={ticket}
        loginId={email}
        field={field}
        label={label}
        onDone={signedInAs}
        onBack={(message) => {
          setTicket(null);
          setProblem(message ? { message } : null);
        }}
      />
    );

  return (
    <>
    {/* Read top to bottom: what this is, how to sign in, the fields, the one action, then help
        (Hick, Miller). It stands on the page's white, no card around it. */}
    <div className="w-full text-left">
      <div className="relative flex items-center gap-3">
        <h1 className="min-w-0 text-[clamp(28px,3vw,34px)] leading-tight font-semibold tracking-[-0.03em] text-[#1f2733]">Sign in to {picked.label}</h1>
        {/* Vite's dev server only: no build has import.meta.hot, so none carries the picker. */}
        {import.meta.hot && (
          <DevUserPicker
            workspace={picked}
            current={email}
            onPick={(id, secret) => {
              setEmail(id);
              setPassword(secret);
              setShown(false);
              setProblem(null);
              submitButton.current?.focus();
            }}
          />
        )}
      </div>
      <p className="mt-2 text-[15px] text-[#5b6472]">Use your own login ID and password.</p>
      <form onSubmit={submit} className="mt-6 grid gap-4" aria-busy={busy}>
        <div className="grid gap-1.5">
          <label htmlFor={`${ids}-id`} className={label}>
            Login ID
          </label>
          <input
            id={`${ids}-id`}
            type="text"
            placeholder="e.g. hos1"
            autoCapitalize="none"
            spellCheck={false}
            autoComplete="username"
            required
            disabled={busy}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setProblem(null);
            }}
            aria-invalid={idError ? true : undefined}
            aria-describedby={idError ? `${ids}-id-error` : undefined}
            className={field}
          />
          {idError && (
            <p id={`${ids}-id-error`} role="alert" className="flex items-start gap-1.5 text-[13px] text-rose-700">
              <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" /> {idError}
            </p>
          )}
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${ids}-password`} className={label}>
            Password
          </label>
          <div className="relative">
            <input
              id={`${ids}-password`}
              type={shown ? "text" : "password"}
              autoComplete="current-password"
              required
              disabled={busy}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setProblem(null);
              }}
              onKeyUp={(event) => setCapsLock(event.getModifierState("CapsLock"))}
              onBlur={() => setCapsLock(false)}
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={[passwordError ? `${ids}-password-error` : "", capsLock ? `${ids}-caps` : ""].filter(Boolean).join(" ") || undefined}
              className={`${field} pr-12`}
            />
            <button
              type="button"
              onClick={() => setShown(!shown)}
              aria-label={shown ? "Hide password" : "Show password"}
              aria-pressed={shown}
              title={shown ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0.5 grid w-11 place-items-center rounded-xl text-[#6b7380] hover:text-[#1f2733] focus-visible:outline-2 focus-visible:outline-[#f36b21]"
            >
              {shown ? <EyeOff className="size-[18px]" aria-hidden="true" /> : <Eye className="size-[18px]" aria-hidden="true" />}
            </button>
          </div>
          {capsLock && (
            <p id={`${ids}-caps`} className="text-[13px] text-[#8a4b00]">
              Caps Lock is on.
            </p>
          )}
          {passwordError && (
            <p id={`${ids}-password-error`} role="alert" className="flex items-start gap-1.5 text-[13px] text-rose-700">
              <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" /> {passwordError}
            </p>
          )}
        </div>
        <button
          ref={submitButton}
          type="submit"
          disabled={busy}
          className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#f36b21] text-[15px] font-semibold text-white shadow-[0_12px_26px_-12px_rgba(243,107,33,0.7)] transition-colors hover:bg-[#e05a12] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f36b21] disabled:cursor-wait disabled:opacity-70"
        >
          {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-6 border-t border-[#eceef3] pt-4 text-[13px] text-[#5b6472]">
        First sign-in or forgot your password? Ask your administrator for a one-time password.
      </p>
    </div>
    </>
  );
}

/** The second step: the six digits their authenticator app shows, or a recovery code. */
function CodeStep(props: {
  ticket: string;
  loginId: string;
  field: string;
  label: string;
  onDone: (me: Me) => void;
  /** Back to the password, with why when it wasn't their choice. */
  onBack: (message?: string) => void;
}) {
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    if (!busy) input.current?.focus();
  }, [recovery, busy]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      props.onDone((await api<{ me: Me }>("/api/auth/login/code", { body: { ticket: props.ticket, code } })).me);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) return props.onBack(error.message);
      setProblem(error instanceof ApiFailure ? error.message : "Couldn't check the code. Try again.");
      setBusy(false);
    }
  }
  const quiet = "inline-flex min-h-11 items-center font-semibold text-[#5b6472] hover:text-[#c2410c]";

  return (
    <div className="w-full text-left">
      <h1 className="text-[clamp(28px,3vw,34px)] leading-tight font-semibold tracking-[-0.03em] text-[#1f2733]">
        {recovery ? "Enter a recovery code" : "Enter your code"}
      </h1>
      <p className="mt-2 text-[15px] text-[#5b6472]">
        {recovery ? "One of the codes you saved when you set up two-step sign-in, for " : "Open your authenticator app and type the six digits for "}
        <span className="inline-block max-w-full font-semibold break-all text-[#1f2733]">{props.loginId}</span>.
      </p>
      <form onSubmit={submit} className="mt-6 grid gap-4" aria-busy={busy}>
        <div className="grid gap-1.5">
          <label htmlFor={id} className={props.label}>
            {recovery ? "Recovery code" : "Six-digit code"}
          </label>
          <input
            ref={input}
            id={id}
            inputMode={recovery ? "text" : "numeric"}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            required
            disabled={busy}
            maxLength={24}
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setProblem(null);
            }}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-error` : undefined}
            className={`${props.field} font-mono`}
          />
          {problem && (
            <p id={`${id}-error`} role="alert" className="flex items-start gap-1.5 text-[13px] text-rose-700">
              <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" /> {problem}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={busy}
          className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#f36b21] text-[15px] font-semibold text-white transition-colors hover:bg-[#e05a12] disabled:cursor-wait disabled:opacity-70"
        >
          {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
          {busy ? "Checking…" : "Verify and sign in"}
        </button>
      </form>
      <div className="mt-3 flex flex-wrap justify-between gap-x-4 text-[13px]">
        <button
          type="button"
          className={quiet}
          onClick={() => {
            setRecovery(!recovery);
            setCode("");
            setProblem(null);
          }}
        >
          {recovery ? "Use your authenticator app" : "Use a recovery code"}
        </button>
        <button type="button" className={quiet} onClick={() => props.onBack()}>
          Back to password
        </button>
      </div>
      <p className="mt-3 border-t border-[#eceef3] pt-4 text-[13px] text-[#5b6472]">
        Lost your phone and your codes? Ask your administrator to reset two-step sign-in.
      </p>
    </div>
  );
}

/** A line that waves between two shapes of itself, slowly, about the same level. */
function Wave({ a, b, dur, className, stroke, strokeOpacity, strokeWidth }: { a: string; b: string; dur: number; className?: string; stroke: string; strokeOpacity: string; strokeWidth: string }) {
  return (
    <path className={className} d={a} stroke={stroke} strokeOpacity={strokeOpacity} strokeWidth={strokeWidth} fill="none">
      <animate attributeName="d" values={`${a};${b};${a}`} keyTimes="0;0.5;1" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1" dur={`${dur}s`} repeatCount="indefinite" />
    </path>
  );
}

/** The logo's orbit, drawn wide and quiet behind the board: orange and green lines and a star. */
function Orbits() {
  return (
    <svg aria-hidden="true" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 -z-10 h-full w-full">
      <g className="orbit-drift">
        <Wave a="M-80 700C220 560 520 820 860 690S1300 420 1540 520" b="M-80 690C220 610 520 770 860 702S1300 470 1540 508" dur={9} stroke="#f36b21" strokeOpacity=".45" strokeWidth="2.2" />
        <Wave className="orbit-flow" a="M-80 742C240 610 540 860 880 734S1320 470 1540 566" b="M-80 730C240 655 540 815 880 746S1320 518 1540 554" dur={9} stroke="#f36b21" strokeOpacity=".32" strokeWidth="1.6" />
        <ellipse cx="200" cy="130" rx="300" ry="80" transform="rotate(-8 200 130)" stroke="#f36b21" strokeOpacity=".14" strokeWidth="1.5" fill="none" />
      </g>
      <g className="orbit-drift-back">
        <Wave a="M-60 210C260 120 470 300 760 220S1210 40 1520 150" b="M-60 198C260 165 470 255 760 232S1210 90 1520 138" dur={10} stroke="#1f9d55" strokeOpacity=".42" strokeWidth="2.2" />
        <Wave className="orbit-flow" a="M-60 250C280 165 490 342 780 262S1230 84 1520 194" b="M-60 238C280 210 490 298 780 274S1230 132 1520 182" dur={10} stroke="#1f9d55" strokeOpacity=".3" strokeWidth="1.6" />
        <ellipse cx="1210" cy="760" rx="380" ry="110" transform="rotate(-12 1210 760)" stroke="#1f9d55" strokeOpacity=".16" strokeWidth="1.5" fill="none" />
      </g>
      <path className="orbit-twinkle" d="M1335 118l6 15 15 6-15 6-6 15-6-15-15-6 15-6z" fill="#1f9d55" fillOpacity=".6" />
      <path className="orbit-twinkle" style={{ animationDelay: "1.6s" }} d="M110 640l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#f36b21" fillOpacity=".55" />
      <circle className="orbit-twinkle" style={{ animationDelay: "0.8s" }} cx="1060" cy="250" r="4" fill="#f36b21" fillOpacity=".5" />
      <circle className="orbit-twinkle" style={{ animationDelay: "2.4s" }} cx="360" cy="800" r="3" fill="#1f9d55" fillOpacity=".5" />
      <path className="orbit-twinkle" style={{ animationDelay: "0.4s" }} d="M560 92l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#f36b21" fillOpacity=".6" />
      <path className="orbit-twinkle" style={{ animationDelay: "2s" }} d="M1250 600l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#1f9d55" fillOpacity=".55" />
      <circle className="orbit-twinkle" style={{ animationDelay: "1.2s" }} cx="80" cy="330" r="3.5" fill="#f36b21" fillOpacity=".45" />
      <circle className="orbit-twinkle" style={{ animationDelay: "2.8s" }} cx="1390" cy="420" r="3" fill="#f36b21" fillOpacity=".45" />
      <circle className="orbit-twinkle" style={{ animationDelay: "3.3s" }} cx="930" cy="840" r="3.5" fill="#1f9d55" fillOpacity=".45" />
      <circle className="orbit-twinkle" style={{ animationDelay: "0.2s" }} cx="700" cy="40" r="2.5" fill="#1f9d55" fillOpacity=".5" />
    </svg>
  );
}
