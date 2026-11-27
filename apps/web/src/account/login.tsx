// Bishnoi One's company portal (the sign-in page), as an app launcher (Aryan, 18 Nov): a tile per
// workspace; any tile opens the same sign-in (the person's own login ID and password), and each
// person's own login decides what opens inside. Only a look: permissions and the pages are unchanged.

import "@fontsource-variable/inter";
import type { Me, SignInAnswer } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { type FormEvent, lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiFailure, api } from "../api";
import { ME, rememberPerson, returnTo, useMe } from "../auth";
import { DepartmentsMenu } from "./departments-menu";
import { DESK_KEYS, DeskOrOwn } from "./desk-sign-in";
import { DevUserPicker } from "./dev-user-picker";
import { LocalOpenList } from "./local-open-list";
import { markActive } from "./idle";
import { DepartmentCollage } from "../portal/department-collage";
import { DepartmentMark } from "../portal/department-side";
import { rememberWorkspace, type Workspace, WORKSPACES, workspaceOf } from "../workspaces";

// The exported home page's sections, under the current page for now (local only, before the redesign).
const HomeExport = lazy(() => import("../home-export"));
const HomeTop = lazy(() => import("../home-export").then((module) => ({ default: module.HomeTop })));

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
  // Add another account (26 Nov: "like Google"): signed in already, this browser keeps that account
  // beside the one signed in here, to switch between from the avatar menu.
  const adding = params.get("add") === "1";
  const search = adding ? "?add=1" : "";
  // The tile pressed opens its department's page, the sign-in below it (the login decides what
  // opens inside, as always).
  // Its address is /login/<key>. The older /login?dept=<key> is still read, then rewritten.
  const asked = (dept ?? params.get("dept"))?.toLowerCase();
  const picked = WORKSPACES.find((one) => one.key === asked) ?? null;
  const address = loginPath(picked?.key);
  // Where the dev-only demo-user picker shows: in the top bar, after "Wrong department?".
  const [pickerSlot, setPickerSlot] = useState<HTMLSpanElement | null>(null);
  const open = (key: string | null) =>
    navigate({ pathname: loginPath(key), search }, { state: location.state });

  useEffect(() => {
    if (!picked) return;
    window.scrollTo({ top: 0 });
    const close = (event: KeyboardEvent) => event.key === "Escape" && open(null);
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
    // biome-ignore lint/correctness/useExhaustiveDependencies: on the department changing only
  }, [picked?.key]);

  if (me.data && !adding) return <Navigate to={landing(me.data.role, picked, returnTo(me.data.id, from))} replace />;
  // An old link, an unknown department or other capitals: the one right address, without a step back to the wrong one.
  if (location.pathname !== address || params.has("dept"))
    return <Navigate to={{ pathname: address, search, hash: location.hash }} state={location.state} replace />;

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
        <div className="relative z-10 flex min-h-dvh flex-col bg-white lg:h-dvh lg:flex-row lg:overflow-hidden">
          <aside className="relative order-2 h-[620px] lg:order-1 lg:h-auto lg:w-[50%]">
            <DepartmentCollage
              workspace={picked}
              brand={
                <Link
                  to={loginPath()}
                  state={location.state}
                  aria-label="Bishnoi One, home"
                  className={`${HOME_LINK} hidden lg:flex`}
                >
                  {/* The mark alone, in white on the orange. */}
                  <img src="/brand/bishnoi-one-mark.png" alt="" className="size-10 brightness-0 invert" />
                </Link>
              }
            />
          </aside>
          <section className="order-1 flex flex-1 flex-col px-6 py-5 lg:order-2 lg:px-12 lg:py-8" aria-label={`Sign in to ${picked.label}`}>
            <div className="flex items-center justify-between gap-3">
              <Link to={loginPath()} state={location.state} className={`${HOME_LINK} flex lg:invisible`}>
                <img src="/brand/bishnoi-one-mark.png" alt="" className="size-7" />
                <span className="text-[17px] font-semibold tracking-[-0.03em]">Bishnoi One</span>
              </Link>
              <span className="flex items-center gap-3">
                <span className="hidden text-[13px] text-[#7a8394] sm:inline">Wrong department?</span>
                {/* The dev-only demo-user picker lands here (SignIn puts it in with a portal). */}
                <span ref={setPickerSlot} className="relative flex empty:hidden" />
                <DepartmentsMenu current={picked.key} onPick={open} />
              </span>
            </div>
            <div className="flex flex-1 justify-center pt-8 pb-10 lg:items-center lg:py-10">
              <div className="w-full max-w-[22rem]">
                <div className="mb-5 lg:hidden">
                  <DepartmentMark workspace={picked} />
                </div>
                {adding && me.data && (
                  <div className="mb-5 rounded-2xl border border-[#d5d9e1] bg-white px-4 py-3 text-[13px] text-[#4b5260]">
                    Adding another account. <b className="text-[#1f2733]">{me.data.name}</b> stays signed in: switch between
                    them from your picture at the top.{" "}
                    <Link to="/" className="font-semibold text-[#f36b21] hover:underline">
                      Cancel
                    </Link>
                  </div>
                )}
                {(() => {
                  const own = (
                    <SignIn
                      workspace={picked}
                      from={from}
                      loginId={(location.state as { loginId?: string } | null)?.loginId}
                      pickerSlot={pickerSlot}
                      adding={adding}
                    />
                  );
                  // Management, Finance and Dispatch: the desks' common password first, when the
                  // company's Admin has set one (desk-sign-in.tsx).
                  return DESK_KEYS.includes(picked.key) && !adding ? <DeskOrOwn workspace={picked} own={own} /> : own;
                })()}
              </div>
            </div>
          </section>
        </div>
      ) : (
        <>
          {/* The first screen is the home page's navbar and hero (home-export, Aryan 23 Nov). */}
          <Suspense fallback={<div className="min-h-dvh bg-white" />}>
            <HomeTop />
          </Suspense>

          <Suspense fallback={null}>
            <HomeExport />
          </Suspense>
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

/** The sign-in, the same for every department: login ID and password, as always. With no
 *  department (the navbar's Sign in, Aryan 26 Nov: "first the company's ID and password, then its
 *  apps"), it signs in to the person's company and their own department, and the company's apps
 *  to choose from come after (choose-system.tsx). */
export function SignIn({
  workspace,
  from,
  loginId,
  pickerSlot,
  adding = false,
}: { workspace: Workspace | null; from: string; loginId?: string; pickerSlot: HTMLElement | null; adding?: boolean }) {
  const queries = useQueryClient();
  const navigate = useNavigate();
  // With several companies on the server: the one this browser signs in to (companies.ts).
  const [email, setEmail] = useState(loginId ?? "");
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
  useEffect(() => setTicket(null), [workspace?.key]);
  const field =
    "h-11 w-full rounded-full border border-[#d5d9e1] bg-white px-5 text-[14px] text-[#1f2733] shadow-none outline-none transition-[border-color,outline-color] placeholder:text-[#6b7380] hover:border-[#b9bfcb] focus:border-[#f36b21] focus:outline-solid! focus:outline-2! focus:outline-offset-2! focus:outline-[#f36b21]! disabled:bg-[#f6f7f9] aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus:outline-rose-500!";
  const label = "text-[12.5px] font-semibold text-[#1f2733]";

  /** Signed in: the person's own landing, as always. */
  const signedInAs = (signedIn: Me) => {
    // An account added: the whole app opens afresh as it, nothing of the other account's left on screen.
    if (adding) {
      rememberWorkspace(workspaceOf(signedIn).key);
      rememberPerson(signedIn.id);
      window.location.assign(landing(signedIn.role, workspace, "/"));
      return;
    }
    const back = returnTo(signedIn.id, from);
    markActive();
    queries.setQueryData(ME, signedIn);
    rememberWorkspace(workspaceOf(signedIn).key);
    // The company's sign-in: the apps this login may open come next, unless a page was waiting.
    navigate(picked ? landing(signedIn.role, picked, back) : back === "/" ? "/signin" : back, { replace: true });
    rememberPerson(signedIn.id);
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const answer = await api<SignInAnswer>("/api/auth/login", {
        body: { email, password, ...(picked ? { workspace: picked.key } : {}), ...(adding ? { add: true } : {}) },
      });
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
        adding={adding}
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
        <h1 className="min-w-0 text-[clamp(24px,2.4vw,28px)] leading-tight font-semibold tracking-[-0.03em] text-[#1f2733]">
          {picked ? `Sign in to ${picked.label}` : "Sign in to your company"}
        </h1>
        {/* Vite's dev server only: no build has import.meta.hot, so none carries the picker. */}
        {import.meta.hot &&
          picked &&
          pickerSlot &&
          createPortal(
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
          />,
            pickerSlot,
          )}
      </div>
      <form onSubmit={submit} className="mt-5 grid gap-3.5" aria-busy={busy}>
        <div className="grid gap-1.5">
          <label htmlFor={`${ids}-id`} className={label}>
            Login ID
          </label>
          <input
            id={`${ids}-id`}
            type="text"
            placeholder={picked ? "Enter your login ID (e.g. hos1)" : "Company ID or your login ID"}
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
              placeholder="Enter your password"
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
              className="absolute inset-y-0 right-1.5 grid w-10 place-items-center rounded-full text-[#6b7380] hover:text-[#1f2733] focus-visible:outline-2 focus-visible:outline-[#f36b21]"
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
          className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#f36b21] text-[14px] font-semibold text-white transition-colors hover:bg-[#e05a12] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f36b21] disabled:cursor-wait disabled:opacity-70"
        >
          {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {/* No Sign up here (Aryan, 27 Nov: "the Admin adds people"): the Admin gives each new
          person their login and a one-time password. */}
      <div className="mt-5 grid gap-1 border-t border-[#eceef3] pt-3 text-[12.5px] text-[#5b6472]">
        <p>Forgot your password? Ask your administrator for a one-time password.</p>
      </div>
      {/* Vite's dev server only, and only where the API lets anyone in (local-open-list.tsx). */}
      {import.meta.hot && !adding && <LocalOpenList workspace={picked} onOpened={signedInAs} />}
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
  /** Adding another account: kept beside the one in use. */
  adding?: boolean;
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
      props.onDone(
        (await api<{ me: Me }>("/api/auth/login/code", { body: { ticket: props.ticket, code, ...(props.adding ? { add: true } : {}) } })).me,
      );
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) return props.onBack(error.message);
      setProblem(error instanceof ApiFailure ? error.message : "Couldn't check the code. Try again.");
      setBusy(false);
    }
  }
  const quiet = "inline-flex min-h-11 items-center font-semibold text-[#5b6472] hover:text-[#c2410c]";

  return (
    <div className="w-full text-left">
      <h1 className="text-[clamp(24px,2.4vw,28px)] leading-tight font-semibold tracking-[-0.03em] text-[#1f2733]">
        {recovery ? "Enter a recovery code" : "Enter your code"}
      </h1>
      <p className="mt-1.5 text-[14px] text-[#5b6472]">
        {recovery ? "One of the codes you saved when you set up two-step sign-in, for " : "Open your authenticator app and type the six digits for "}
        <span className="inline-block max-w-full font-semibold break-all text-[#1f2733]">{props.loginId}</span>.
      </p>
      <form onSubmit={submit} className="mt-5 grid gap-3.5" aria-busy={busy}>
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
          className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#f36b21] text-[14px] font-semibold text-white transition-colors hover:bg-[#e05a12] disabled:cursor-wait disabled:opacity-70"
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
