// Bishnoi One's company portal (the sign-in page), as an app launcher (Aryan, 18 Nov): a tile per
// workspace; any tile opens the same sign-in (login ID and password, as always), and each person's
// own login decides what opens inside. Only a look: permissions and the pages are unchanged.

import "@fontsource-variable/inter";
import type { Me } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, ChevronRight, Eye, EyeOff, KeyRound, LoaderCircle, Search, UserRound, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiFailure, api } from "../api";
import { ME, useMe } from "../auth";
import { TILE_GLOW, TILE_ICONS } from "../portal/tiles";
import { lastWorkspace, rememberWorkspace, type Workspace, WORKSPACES, workspaceOf } from "../workspaces";

const GROUPS = [
  { key: "all", label: "All workspaces" },
  { key: "selling", label: "Selling" },
  { key: "operations", label: "Operations" },
  { key: "office", label: "Office" },
] as const;

export function Login() {
  const me = useMe();
  const queries = useQueryClient();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; field?: string } | null>(null);
  // The tile pressed (only a look: the login decides what opens).
  const [picked, setPicked] = useState<Workspace | null>(null);
  const [find, setFind] = useState("");
  const [group, setGroup] = useState<(typeof GROUPS)[number]["key"]>("all");
  const [groupOpen, setGroupOpen] = useState(false);
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
    (one) => (group === "all" || one.group === group) && (!words || `${one.label} ${one.about}`.toLowerCase().includes(words)),
  );
  const field =
    "h-12 w-full rounded-2xl border border-white/70 bg-white/70 pl-11 text-[15px] text-[#1f2733] shadow-[inset_0_1px_2px_rgba(20,30,50,0.06)] outline-none backdrop-blur placeholder:text-[#9aa2b0] focus:border-[#f36b21]/60 focus:bg-white focus:ring-4 focus:ring-[#f36b21]/15";

  return (
    <main className="relative isolate min-h-dvh overflow-hidden bg-[#f6f7fb] font-[Inter_Variable,Inter,sans-serif] text-[#1f2733]">
      {/* Soft colour behind the glass, faded. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -left-32 size-[34rem] rounded-full bg-[#ffd9c2] opacity-60 blur-[120px]" />
        <div className="absolute top-1/3 -right-40 size-[36rem] rounded-full bg-[#cfe8d8] opacity-60 blur-[120px]" />
        <div className="absolute -bottom-48 left-1/3 size-[32rem] rounded-full bg-[#dcd6ff] opacity-50 blur-[120px]" />
      </div>

      <header className="mx-auto flex w-[min(1180px,calc(100%-32px))] items-center gap-4 py-6">
        <span className="flex shrink-0 items-center gap-2.5">
          <img src="/brand/bishnoi-one-mark.png" alt="" className="size-10" />
          <span className="hidden text-[22px] font-semibold tracking-[-0.03em] sm:inline">Bishnoi One</span>
        </span>
        <label className="mx-auto flex h-12 w-full max-w-md items-center gap-3 rounded-2xl border border-white/80 bg-white/70 px-4 shadow-[0_8px_30px_-12px_rgba(20,30,50,0.18)] backdrop-blur-xl">
          <Search className="size-5 text-[#f36b21]" aria-hidden="true" />
          <input
            value={find}
            onChange={(event) => setFind(event.target.value)}
            placeholder="Search workspaces"
            aria-label="Search workspaces"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#7a8394]"
          />
        </label>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setGroupOpen(!groupOpen)}
            aria-expanded={groupOpen}
            className="flex h-12 items-center gap-2 rounded-2xl border border-white/80 bg-white/70 px-4 text-sm font-medium shadow-[0_8px_30px_-12px_rgba(20,30,50,0.18)] backdrop-blur-xl"
          >
            {GROUPS.find((one) => one.key === group)?.label}
            <ChevronDown className="size-4" aria-hidden="true" />
          </button>
          {groupOpen && (
            <div className="absolute right-0 z-20 mt-2 w-48 rounded-2xl border border-white/80 bg-white/90 p-1.5 shadow-[0_20px_50px_-20px_rgba(20,30,50,0.35)] backdrop-blur-xl">
              {GROUPS.map((one) => (
                <button
                  key={one.key}
                  type="button"
                  onClick={() => {
                    setGroup(one.key);
                    setGroupOpen(false);
                  }}
                  className={`flex h-10 w-full items-center rounded-xl px-3 text-left text-sm ${group === one.key ? "bg-[#f36b21]/10 font-semibold text-[#c2410c]" : "hover:bg-black/5"}`}
                >
                  {one.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* The tiles; every one opens the same sign-in. */}
      <section aria-label="Workspaces" className="mx-auto w-[min(1000px,calc(100%-32px))] pt-8 pb-28">
        <ul className="mx-auto flex max-w-[52rem] flex-wrap justify-center gap-x-8 gap-y-10">
          {shownTiles.map((one) => {
            const Icon = TILE_ICONS[one.key];
            return (
              <li key={one.key} className="flex w-[8.5rem] justify-center">
                <button type="button" onClick={() => setPicked(one)} className="group flex flex-col items-center gap-3.5 focus-visible:outline-none">
                  <span className="relative grid size-[7.5rem] place-items-center">
                    {/* The tile's own colour, faded, behind the glass. */}
                    <span
                      aria-hidden="true"
                      className="absolute inset-3 rounded-[2rem] opacity-25 blur-2xl transition-opacity duration-300 group-hover:opacity-45"
                      style={{ background: TILE_GLOW[one.key] }}
                    />
                    <span className="relative grid size-[7.5rem] place-items-center rounded-[2rem] border border-white/90 bg-white/75 shadow-[0_18px_40px_-18px_rgba(20,30,50,0.28),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl transition duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_26px_50px_-20px_rgba(20,30,50,0.35)] group-focus-visible:ring-4 group-focus-visible:ring-[#f36b21]/30">
                      <span className="size-16 transition-transform duration-300 group-hover:scale-105">{Icon && <Icon />}</span>
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

      {/* The page fades at the bottom, with the way to ask for access. */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#f6f7fb] via-[#f6f7fb]/85 to-transparent" />
      <p className="fixed right-6 bottom-6 z-10 flex items-center gap-1 text-sm font-medium text-[#3c4452]">
        Need access? Ask your administrator <ChevronRight className="size-4" aria-hidden="true" />
      </p>

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
                  placeholder="Login ID (hos1, tl1 or email)"
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
                  placeholder="Password"
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
            <p className="mt-4 text-xs text-[#9aa2b0]">2MG Inc. · GetMeds Philippines Inc.</p>
          </div>
        </div>
      )}
    </main>
  );
}
