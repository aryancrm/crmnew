// Bishnoi One's company portal (the sign-in page), as an app launcher (Aryan, 18 Nov): a tile per
// workspace; any tile opens the same sign-in (login ID and password, as always), and each person's
// own login decides what opens inside. Only a look: permissions and the pages are unchanged.

import "@fontsource-variable/inter";
import type { Me } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ChevronRight, Eye, EyeOff, KeyRound, LoaderCircle, Search, UserRound, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ApiFailure, api } from "../api";
import { ME, useMe } from "../auth";
import { ClassicLogin } from "./login-classic";
import { About } from "../portal/about";
import { TILE_GLOW, TILE_ICONS } from "../portal/tiles";
import { lastWorkspace, rememberWorkspace, type Workspace, WORKSPACES, workspaceOf } from "../workspaces";

/** The sign-in: the workspace launcher, or (Log in with ID and password) the screen as it was. */
export function Login() {
  const [params] = useSearchParams();
  return params.get("with") === "password" ? <ClassicLogin /> : <Launcher />;
}

function Launcher() {
  const me = useMe();
  const queries = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; field?: string } | null>(null);
  // The tile pressed (only a look: the login decides what opens).
  const [picked, setPicked] = useState<Workspace | null>(null);
  const [find, setFind] = useState("");
  const last = lastWorkspace();

  useEffect(() => {
    if (!picked) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setPicked(null);
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [picked]);

  if (me.data) return <Navigate to={from} replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const { me: signedIn } = await api<{ me: Me }>("/api/auth/login", { body: { email, password } });
      queries.setQueryData(ME, signedIn);
      rememberWorkspace(workspaceOf(signedIn).key);
      navigate(from, { replace: true });
    } catch (error) {
      setProblem(error instanceof ApiFailure ? { message: error.message, field: error.field } : { message: "Couldn't sign in. Try again." });
    } finally {
      setBusy(false);
    }
  }

  const words = find.trim().toLowerCase();
  const shownTiles = WORKSPACES.filter(
    (one) => !words || `${one.label} ${one.about}`.toLowerCase().includes(words),
  );
  const field =
    "h-12 w-full rounded-2xl border border-white/70 bg-white/70 pl-11 text-[15px] text-[#1f2733] shadow-[inset_0_1px_2px_rgba(20,30,50,0.06)] outline-none backdrop-blur placeholder:text-[#9aa2b0] focus:border-[#f36b21]/60 focus:bg-white focus:ring-4 focus:ring-[#f36b21]/15";

  return (
    <main className="relative isolate overflow-x-hidden bg-[#f6f7fb] font-[Inter_Variable,Inter,sans-serif] text-[#1f2733]">
      {/* The first screen: the launcher, whole in the window. */}
      <div className="relative isolate flex min-h-dvh flex-col overflow-hidden md:h-dvh">
      <Orbits />
      {/* Soft colour behind the glass, faded. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -left-32 size-[34rem] rounded-full bg-[#ffd9c2] opacity-60 blur-[120px]" />
        <div className="absolute top-1/3 -right-40 size-[36rem] rounded-full bg-[#cfe8d8] opacity-60 blur-[120px]" />
        <div className="absolute -bottom-48 left-1/3 size-[32rem] rounded-full bg-[#dcd6ff] opacity-50 blur-[120px]" />
      </div>

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
                <button type="button" onClick={() => setPicked(one)} className="group flex flex-col items-center gap-2.5 focus-visible:outline-none">
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

      {/* The other way in: the sign-in as it was. */}
      <footer className="mx-auto flex w-[min(1180px,calc(100%-32px))] shrink-0 flex-wrap items-center justify-between gap-3 pb-5">
        <a href="#about" className="text-xs font-medium text-[#5b6472] hover:text-[#c2410c]">What is Bishnoi One? ↓</a>
        <Link
          to="/login?with=password"
          state={location.state}
          className="flex items-center gap-1.5 rounded-full border border-white/90 bg-white/70 px-4 py-2 text-sm font-semibold text-[#1f2733] shadow-[0_8px_24px_-12px_rgba(20,30,50,0.25)] backdrop-blur-xl hover:text-[#c2410c]"
        >
          Log in with ID and password <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
        <span className="text-xs text-[#8a93a3]">Need access? Ask your administrator</span>
      </footer>
      </div>

      <About onPick={setPicked} />

      {/* The same sign-in, whichever tile was pressed. */}
      {picked && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-[#eef0f5]/60 p-4 backdrop-blur-md">
          <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" onClick={() => setPicked(null)} />
          <div role="dialog" aria-modal="true" aria-label={`Sign in to ${picked.label}`} className="relative w-full max-w-sm rounded-[2rem] border border-white/90 bg-white/85 p-7 text-center shadow-[0_40px_90px_-30px_rgba(20,30,50,0.45)] backdrop-blur-2xl">
            <button type="button" onClick={() => setPicked(null)} aria-label="Back to all workspaces" className="absolute top-4 right-4 grid size-9 place-items-center rounded-full text-[#7a8394] hover:bg-black/5">
              <X className="size-4" />
            </button>
            <span className="relative mx-auto grid size-20 place-items-center">
              <span aria-hidden="true" className="absolute inset-2 rounded-[1.4rem] opacity-30 blur-xl" style={{ background: TILE_GLOW[picked.key] }} />
              <span className="relative grid size-20 place-items-center rounded-[1.4rem] border border-white bg-white shadow-[0_14px_30px_-14px_rgba(20,30,50,0.3)]">
                <span className="size-11">{(() => {
                  const Icon = TILE_ICONS[picked.key];
                  return Icon ? <Icon /> : null;
                })()}</span>
              </span>
            </span>
            <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">{picked.label}</h1>
            <p className="mt-0.5 text-sm text-[#7a8394]">Sign in as yourself</p>
            <form onSubmit={submit} className="mt-6 grid gap-3 text-left" aria-busy={busy}>
              <label className="relative block">
                <span className="sr-only">Login ID</span>
                <UserRound className="pointer-events-none absolute top-1/2 left-4 z-10 size-4 -translate-y-1/2 text-[#9aa2b0]" aria-hidden="true" />
                <input
                  type="text"
                  placeholder="Enter your login ID"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoComplete="username"
                  // biome-ignore lint/a11y/noAutofocus: the tile was just pressed to sign in
                  autoFocus
                  required
                  disabled={busy}
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setProblem(null);
                  }}
                  aria-invalid={problem?.field === "email"}
                  className={field}
                />
              </label>
              <label className="relative block">
                <span className="sr-only">Password</span>
                <KeyRound className="pointer-events-none absolute top-1/2 left-4 z-10 size-4 -translate-y-1/2 text-[#9aa2b0]" aria-hidden="true" />
                <input
                  type={shown ? "text" : "password"}
                  placeholder="Enter your login password"
                  autoComplete="current-password"
                  required
                  disabled={busy}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setProblem(null);
                  }}
                  aria-invalid={problem?.field === "password"}
                  aria-describedby={problem ? "login-error" : undefined}
                  className={`${field} pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShown(!shown)}
                  aria-label={shown ? "Hide password" : "Show password"}
                  aria-pressed={shown}
                  className="absolute inset-y-0 right-1 grid w-11 place-items-center text-[#9aa2b0] hover:text-[#1f2733]"
                >
                  {shown ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                </button>
              </label>
              {problem && (
                <p id="login-error" role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {problem.message}
                </p>
              )}
              <button
                type="submit"
                disabled={busy}
                className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#f36b21] text-sm font-semibold text-white shadow-[0_14px_30px_-12px_rgba(243,107,33,0.7)] transition-colors hover:bg-[#e05a12] disabled:opacity-60"
              >
                {busy ? "Signing in…" : `Enter ${picked.label}`}
                {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="size-4" aria-hidden="true" />}
              </button>
            </form>
            <p className="mt-4 text-xs text-[#9aa2b0]">Bishnoi One · your workspace</p>
          </div>
        </div>
      )}
    </main>
  );
}

/** The logo's orbit, drawn wide and quiet behind the board: orange and green lines and a star. */
function Orbits() {
  return (
    <svg aria-hidden="true" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 -z-10 h-full w-full">
      <g className="orbit-drift">
        <path d="M-80 700C220 560 520 820 860 690S1300 420 1540 520" stroke="#f36b21" strokeOpacity=".45" strokeWidth="2.2" fill="none" />
        <path className="orbit-flow" d="M-80 742C240 610 540 860 880 734S1320 470 1540 566" stroke="#f36b21" strokeOpacity=".32" strokeWidth="1.6" fill="none" />
        <ellipse cx="200" cy="130" rx="300" ry="80" transform="rotate(-8 200 130)" stroke="#f36b21" strokeOpacity=".14" strokeWidth="1.5" fill="none" />
      </g>
      <g className="orbit-drift-back">
        <path d="M-60 210C260 120 470 300 760 220S1210 40 1520 150" stroke="#1f9d55" strokeOpacity=".42" strokeWidth="2.2" fill="none" />
        <path className="orbit-flow" d="M-60 250C280 165 490 342 780 262S1230 84 1520 194" stroke="#1f9d55" strokeOpacity=".3" strokeWidth="1.6" fill="none" />
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
