// Bishnoi One's company portal (the sign-in page), as an app launcher (Aryan, 18 Nov): a tile per
// workspace; any tile opens the same sign-in (login ID and password, as always), and each person's
// own login decides what opens inside. Only a look: permissions and the pages are unchanged.

import "@fontsource-variable/inter";
import type { DoorList, Me } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, CircleAlert, Eye, EyeOff, LoaderCircle, Search } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ApiFailure, api } from "../api";
import { ME, rememberPerson, returnTo, useMe } from "../auth";
import { About } from "../portal/about";
import { DepartmentMark, DepartmentSide } from "../portal/department-side";
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
  const [params] = useSearchParams();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  // The tile pressed opens its department's page, the sign-in below it (the login decides what
  // opens inside, as always).
  const picked = WORKSPACES.find((one) => one.key === params.get("dept")) ?? null;
  const [find, setFind] = useState("");
  const last = lastWorkspace();
  const open = (key: string | null) =>
    navigate({ search: key ? `?dept=${key}` : "" }, { state: location.state });

  useEffect(() => {
    if (!picked) return;
    window.scrollTo({ top: 0 });
    const close = (event: KeyboardEvent) => event.key === "Escape" && open(null);
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
    // biome-ignore lint/correctness/useExhaustiveDependencies: on the department changing only
  }, [picked?.key]);

  if (me.data) return <Navigate to={landing(me.data.role, picked, returnTo(me.data.id, from))} replace />;

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
        <div className="flex min-h-dvh flex-col">
          <header className="mx-auto flex w-[min(1240px,calc(100%-32px))] items-center gap-2.5 py-2.5">
            <img src="/brand/bishnoi-one-mark.png" alt="" className="size-7" />
            <span className="text-[18px] font-semibold tracking-[-0.03em]">Bishnoi One</span>
          </header>
          {/* Two sides (Aryan, 21 Nov): the department's icon and information on the left, the
              sign-in alone on the right. Phones: where you are and the sign-in first, the rest below. */}
          <div className="mx-auto w-[min(1180px,calc(100%-32px))] flex-1 pt-2 pb-16">
            <button
              type="button"
              onClick={() => open(null)}
              className="mb-6 inline-flex min-h-9 items-center gap-1.5 text-[13px] font-semibold text-[#5b6472] hover:text-[#c2410c]"
            >
              <ArrowLeft className="size-4" aria-hidden="true" /> All departments
            </button>
            <div className="grid items-center gap-10 lg:min-h-[calc(100dvh-9rem)] lg:grid-cols-[minmax(0,1fr)_24rem] xl:gap-20">
              <section className="mx-auto w-full max-w-sm lg:order-2" aria-label={`Sign in to ${picked.label}`}>
                <div className="mb-6 lg:hidden">
                  <DepartmentTitle workspace={picked} />
                </div>
                <SignIn workspace={picked} from={from} />
              </section>
              <div className="border-t border-[#e3e6ee] pt-8 lg:order-1 lg:border-t-0 lg:pt-0">
                <DepartmentSide workspace={picked} titleOnPhone={false} />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
      {/* The first screen: the launcher, whole in the window. */}
      <div className="relative isolate flex min-h-dvh flex-col overflow-hidden md:h-dvh">
      <Orbits />

      <header className="mx-auto flex w-[min(1180px,calc(100%-32px))] shrink-0 items-center gap-4 py-5">
        <span className="flex shrink-0 items-center gap-2.5">
          <img src="/brand/bishnoi-one-mark.png" alt="" className="size-10" />
          <span className="hidden text-[22px] font-semibold tracking-[-0.03em] sm:inline">Bishnoi One</span>
        </span>
        <label className="mx-auto flex h-12 w-full max-w-md items-center gap-3 rounded-2xl border border-white/80 bg-white/70 px-4 shadow-[0_8px_30px_-12px_rgba(20,30,50,0.18)] backdrop-blur-xl transition focus-within:bg-white/90 focus-within:shadow-[0_12px_36px_-12px_rgba(20,30,50,0.26)]">
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

/** Where you are: the department's mark, its name and what it is for, in one line. */
function DepartmentTitle({ workspace }: { workspace: Workspace }) {
  return (
    <div className="flex items-center gap-4">
      <DepartmentMark workspace={workspace} size="sm" />
      <div className="min-w-0">
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.03em] text-[#1f2733]">{workspace.label}</h1>
        <p className="text-[14px] text-[#5b6472]">{workspace.about}</p>
      </div>
    </div>
  );
}

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
  // Management, Finance and Dispatch share one screen (Aryan, 19 Nov): the company's password opens
  // it, no ID; each person presses Start on it. Their own ID still works ("with my own ID").
  const isDesk = ["management", "finance", "dispatch"].includes(picked.key);
  // The heads' and the team leads' doors (Aryan, 19 Nov: "open Heads, one password, all the heads
  // come; press one and their page opens"): the company's password, then each name; a press signs
  // that person in with their own login ID and that password. Their own ID still works.
  const isDoor = picked.key === "heads" || picked.key === "leads";
  const [ownId, setOwnId] = useState(false);
  const deskOnly = isDesk && !ownId;
  const byName = isDoor && !ownId;
  const [names, setNames] = useState<DoorList["people"] | null>(null);
  const [entering, setEntering] = useState<string | null>(null);
  // Typing the login brings the box forward where it stands and blurs the page behind, as the old
  // pop-up did (Aryan, 18 Nov); a click outside or Esc puts it back.
  const [lifted, setLifted] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const lift = () => {
    if (!lifted) setLifted(true);
  };
  const drop = () => {
    setLifted(false);
    (document.activeElement as HTMLElement | null)?.blur();
  };
  useEffect(() => {
    if (!lifted) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      drop();
    };
    document.addEventListener("keydown", close, true);
    return () => document.removeEventListener("keydown", close, true);
  }, [lifted]);
  const ids = useId();
  const [capsLock, setCapsLock] = useState(false);
  const field =
    "h-12 w-full rounded-xl border border-[#d5d9e1] bg-white px-3.5 text-[15px] text-[#1f2733] outline-none transition-[border-color,box-shadow] placeholder:text-[#6b7380] hover:border-[#b9bfcb] focus:border-[#f36b21] focus:ring-4 focus:ring-[#f36b21]/15 disabled:bg-[#f6f7f9] aria-[invalid=true]:border-rose-500 aria-[invalid=true]:ring-rose-500/15";
  const label = "text-[13px] font-semibold text-[#1f2733]";

  /** Signed in: the person's own landing, as always. */
  const signedInAs = (signedIn: Me) => {
    const back = returnTo(signedIn.id, from);
    queries.setQueryData(ME, signedIn);
    rememberWorkspace(workspaceOf(signedIn).key);
    navigate(landing(signedIn.role, workspace, back), { replace: true });
    rememberPerson(signedIn.id);
  };
  const failed = (error: unknown) =>
    setProblem(error instanceof ApiFailure ? { message: error.message, field: error.field } : { message: "Couldn't sign in. Try again." });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      if (byName) {
        // The door's names, for the password typed (nobody is signed in yet).
        setNames((await api<DoorList>("/api/auth/door", { body: { door: picked.key, password } })).people);
        return;
      }
      const { me: signedIn } = deskOnly
        ? await api<{ me: Me }>("/api/auth/desk", { body: { desk: picked.key, password } })
        : await api<{ me: Me }>("/api/auth/login", { body: { email, password, workspace: picked.key } });
      signedInAs(signedIn);
    } catch (error) {
      failed(error);
    } finally {
      setBusy(false);
    }
  }

  /** A name pressed: that person signs in with their own login ID and the password typed. */
  async function enter(login: string) {
    setEntering(login);
    setProblem(null);
    try {
      signedInAs((await api<{ me: Me }>("/api/auth/login", { body: { email: login, password, workspace: picked.key } })).me);
    } catch (error) {
      failed(error);
    } finally {
      setEntering(null);
    }
  }

  // Each error sits under the field it is about (proximity); one about neither, under the password.
  const sharedPassword = deskOnly || byName;
  const idError = !sharedPassword && problem?.field === "email" ? problem.message : null;
  const passwordError = problem && !idError ? problem.message : null;

  return (
    <>
    {lifted && (
      <button type="button" aria-label="Back to the page" onClick={drop} className="fixed inset-0 z-40 cursor-default bg-[#eef0f5]/55 backdrop-blur-md" />
    )}
    {/* Raised above the page around it, so the eye lands here (Aryan, 18 Nov). Read top to bottom:
        what this is, how to sign in, the fields, the one action, then help (Hick, Miller). */}
    <div
      ref={boxRef}
      onFocus={lift}
      role={lifted ? "dialog" : undefined}
      aria-modal={lifted || undefined}
      aria-label={lifted ? `Sign in to ${picked.label}` : undefined}
      className={`relative w-full max-w-sm rounded-[1.75rem] border border-white bg-white p-7 text-left ring-1 ring-black/[0.04] transition-[scale,box-shadow] duration-200 ease-out ${
        lifted
          ? "z-50 scale-[1.03] shadow-[0_60px_120px_-30px_rgba(20,30,50,0.6),0_24px_48px_-20px_rgba(20,30,50,0.4)]"
          : "shadow-[0_50px_100px_-28px_rgba(20,30,50,0.55),0_18px_36px_-18px_rgba(20,30,50,0.35)]"
      }`}
    >
      <h2 className="text-[24px] leading-tight font-semibold tracking-[-0.025em] text-[#1f2733]">Sign in</h2>
      <p className="mt-1 text-[14px] text-[#5b6472]">
        {deskOnly
          ? "Shared desk screen. Enter the company password."
          : byName
            ? names
              ? "Select your name to continue."
              : "Enter the company password, then select your name."
            : "Use your login ID and password."}
      </p>
      {/* Two ways in (Aryan, 19 Nov): the desk's shared screen, or each person's own login for their
          own things (payslips, leave, their own work). The choice comes before the fields it changes. */}
      {(isDesk || isDoor) && (
        <div role="tablist" aria-label="Sign-in method" className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-[#f1f3f7] p-1 text-[13px] font-semibold">
          {(
            [
              [false, isDoor ? "Select name" : "Shared desk"],
              [true, "Personal login"],
            ] as const
          ).map(([own, text]) => (
            <button
              key={text}
              type="button"
              role="tab"
              aria-selected={ownId === own}
              onClick={() => {
                setOwnId(own);
                setProblem(null);
                setNames(null);
              }}
              className={`h-9 rounded-lg px-3 transition-colors ${ownId === own ? "bg-white text-[#1f2733] shadow-[0_1px_3px_rgba(20,30,50,0.12)]" : "text-[#5b6472] hover:text-[#1f2733]"}`}
            >
              {text}
            </button>
          ))}
        </div>
      )}
      {byName && names ? (
        <DoorNames
          names={names}
          entering={entering}
          problem={problem?.message ?? null}
          onEnter={enter}
          onBack={() => {
            setNames(null);
            setProblem(null);
          }}
        />
      ) : (
      <form onSubmit={submit} className="mt-6 grid gap-4" aria-busy={busy}>
        {!sharedPassword && (
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
        )}
        <div className="grid gap-1.5">
          <label htmlFor={`${ids}-password`} className={label}>
            {sharedPassword ? "Company password" : "Password"}
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
          type="submit"
          disabled={busy}
          className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#f36b21] text-[15px] font-semibold text-white shadow-[0_12px_26px_-12px_rgba(243,107,33,0.7)] transition-colors hover:bg-[#e05a12] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f36b21] disabled:cursor-wait disabled:opacity-70"
        >
          {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
          {busy ? (byName ? "Checking…" : "Signing in…") : byName ? "Continue" : "Sign in"}
        </button>
      </form>
      )}
      <p className="mt-6 border-t border-[#eceef3] pt-4 text-[13px] text-[#5b6472]">Need access? Contact your administrator.</p>
    </div>
    </>
  );
}

/** A door's people by name (a team lead's under their head); a press signs that one in. */
function DoorNames({
  names,
  entering,
  problem,
  onEnter,
  onBack,
}: {
  names: DoorList["people"];
  entering: string | null;
  problem: string | null;
  onEnter: (login: string) => void;
  onBack: () => void;
}) {
  const groups: { head: string | null; people: DoorList["people"] }[] = [];
  for (const one of names) {
    const last = groups.at(-1);
    if (last && last.head === one.head) last.people.push(one);
    else groups.push({ head: one.head, people: [one] });
  }
  return (
    <div className="mt-4 text-left">
      <div className="max-h-[min(26rem,55vh)] overflow-y-auto rounded-2xl border border-[#eef0f4] bg-[#fafbfc] p-1.5">
        {groups.map((group) => (
          <div key={group.head ?? "heads"}>
            {group.head && (
              <p className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-[#9aa2b0] uppercase">
                Under {group.head}
              </p>
            )}
            <ul className="grid gap-1">
              {group.people.map((one) => (
                <li key={one.login}>
                  <button
                    type="button"
                    disabled={entering !== null}
                    onClick={() => onEnter(one.login)}
                    className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-white hover:shadow-[0_6px_18px_-10px_rgba(20,30,50,0.35)] disabled:opacity-60"
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-9 shrink-0 place-items-center rounded-full bg-[#fff1e8] text-[13px] font-semibold text-[#c2410c]"
                    >
                      {one.name
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((word) => word[0])
                        .join("")
                        .toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold text-[#1f2733]">{one.name}</span>
                      <span className="block truncate text-[12px] text-[#7a8394]">{one.boxes.join(" · ")}</span>
                    </span>
                    {entering === one.login ? (
                      <LoaderCircle className="size-4 shrink-0 animate-spin text-[#f36b21]" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-[#9aa2b0]" aria-hidden="true" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {problem && (
        <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {problem}
        </p>
      )}
      <p className="mt-3 text-[13px] text-[#5b6472]">Not listed? Use Personal login.</p>
      <button type="button" onClick={onBack} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#c2410c] hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Enter the password again
      </button>
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
