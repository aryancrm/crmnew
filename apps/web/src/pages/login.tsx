import type { Me } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiFailure, api } from "../api";
import { ME, useMe } from "../auth";

/** Original line artwork: an orderly pharmacy shelf, drawn in the brand's ink. */
function PharmacyMark() {
  return (
    <svg
      viewBox="0 0 480 360"
      fill="none"
      aria-hidden="true"
      className="h-auto max-h-[22vh] lg:max-h-[36vh] w-full"
    >
      <path d="M40 300H440M65 305V321M415 305V321" stroke="#83a99a" strokeWidth="1.5" />
      <path d="M71 111L240 33L409 111V300H71V111Z" stroke="#83a99a" strokeWidth="1.5" />
      <path
        d="M71 111H409M71 205H409M184 111V300M298 111V300"
        stroke="#83a99a"
        strokeOpacity=".6"
      />
      <path d="M232 65V95M217 80H247" stroke="#e6e9d6" strokeWidth="7" />
      <g stroke="#c9d7c9" strokeWidth="1.5">
        <rect x="94" y="144" width="30" height="61" rx="2" />
        <path d="M94 154H124M105 175H114M109.5 170.5V179.5" />
        <rect x="130" y="133" width="32" height="72" rx="2" />
        <path d="M130 146H162M140 157H152M140 162H152" />
        <path d="M215 155V147H265V155L272 166V205H208V166L215 155Z" />
        <rect x="213" y="137" width="54" height="10" rx="2" />
        <path d="M208 174H272M230 187H250" />
        <rect x="319" y="148" width="29" height="57" rx="2" />
        <path d="M319 158H348" />
        <path d="M354 144L374 139L390 200L370 205L354 144Z" />
        <path d="M357 156L377 151" />
        <rect x="93" y="238" width="64" height="62" rx="2" />
        <path d="M93 253H157M106 269H143M106 277H132" />
        <path d="M207 266C207 257 220 250 228 257L250 279C258 287 251 300 242 300C238 300 234 298 231 295L212 277C209 274 207 270 207 266Z" />
        <path d="M218 282L235 265" />
        <path d="M267 242V300M278 251V300" />
        <rect x="321" y="243" width="65" height="57" rx="2" />
        <path d="M321 256H386M348 268V287M338.5 277.5H357.5" />
      </g>
      <circle cx="410" cy="61" r="24" stroke="#83a99a" strokeOpacity=".4" />
      <path d="M400 61H420M410 51V71" stroke="#83a99a" />
      <path d="M41 206H57M49 198V214" stroke="#83a99a" strokeOpacity=".5" />
      <path d="M80 337H400" stroke="#83a99a" strokeOpacity=".25" />
    </svg>
  );
}

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

  if (me.data) return <Navigate to={from} replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const { me: signedIn } = await api<{ me: Me }>("/api/auth/login", {
        body: { email, password },
      });
      queries.setQueryData(ME, signedIn);
      navigate(from, { replace: true });
    } catch (error) {
      setProblem(
        error instanceof ApiFailure
          ? { message: error.message, field: error.field }
          : { message: "Couldn't sign in. Try again." },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh bg-[#f8faf9] lg:grid-cols-[1.05fr_1fr]">
      <section className="relative isolate flex flex-col justify-between gap-4 overflow-hidden bg-[#103e32] px-6 py-6 text-[#edf0e5] sm:px-10 lg:gap-6 lg:py-9 xl:px-16">
        <div aria-hidden="true" className="pointer-events-none absolute -right-36 -top-40 -z-10 size-[600px] rounded-full bg-emerald-500/10 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-64 -left-40 -z-10 size-[600px] rounded-full bg-[#80a78c]/10 blur-3xl" />
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl border border-white/20 bg-white/5 text-base font-semibold">2MG</span>
          <span className="text-xl font-semibold tracking-tight">2MG Inc.</span>
        </div>
        <div className="mx-auto w-full max-w-md">
          <PharmacyMark />
          <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.22em] text-[#b1cebf]">Your company. Connected.</p>
          <h2 className="mt-3 max-w-md font-serif text-3xl leading-[1.18] tracking-tight xl:text-4xl">
            One team.
            <br />A clearer workday.
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-6 text-[#b7cdbf]">
            From the first visit to the final delivery. Keep your people, customers, stock and orders moving together.
          </p>
        </div>
        <div className="hidden justify-between border-t border-[#527e6b]/40 lg:flex pt-4 text-[11px] text-[#a8c2b5]">
          <span>People · Orders · Inventory · Finance</span>
          <span>One workspace</span>
        </div>
      </section>
      <section className="flex min-w-0 flex-col px-5 py-5 sm:px-12 lg:px-16 lg:py-8">
        <div className="flex items-center justify-between">
          <span className="text-lg font-semibold tracking-tight text-[#153e32] lg:invisible">2MG Inc.</span>
          <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <LockKeyhole className="size-3" aria-hidden="true" />
            Team access
          </span>
        </div>
        <div className="mx-auto my-auto w-full max-w-[420px] py-8">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_16px_60px_-24px_rgba(15,55,40,0.18)] sm:p-9">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-800">Welcome back</p>
            <h1 className="mt-2 text-[26px] font-semibold leading-tight tracking-tight text-slate-950 sm:text-[30px]">Welcome to your workspace</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">Sign in with your login ID or work email.</p>
            <form onSubmit={submit} className="mt-6" aria-busy={busy}>
              <label htmlFor="email" className="text-xs font-semibold text-slate-700">Login ID</label>
              <input
                id="email"
                type="text"
                placeholder="hos1, tl1 or name@2mginc.com"
                autoCapitalize="none"
                spellCheck={false}
                autoComplete="username"
                // biome-ignore lint/a11y/noAutofocus: the sign-in page has one job
                autoFocus
                required
                disabled={busy}
                value={email}
                onChange={(event) => { setEmail(event.target.value); setProblem(null); }}
                aria-invalid={problem?.field === "email"}
                className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-[#fbfcfb] px-3.5 text-base outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-700/10 sm:text-sm"
              />
              <label htmlFor="password" className="mt-4 block text-xs font-semibold text-slate-700">Password</label>
              <div className="relative mt-1.5">
                <input
                  id="password"
                  type={shown ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  disabled={busy}
                  value={password}
                  onChange={(event) => { setPassword(event.target.value); setProblem(null); }}
                  aria-invalid={problem?.field === "password"}
                  aria-describedby={problem ? "login-error" : undefined}
                  className="h-12 w-full rounded-xl border border-slate-300 bg-[#fbfcfb] pl-3.5 pr-12 text-base outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-700/10 sm:text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShown((value) => !value)}
                  aria-label={shown ? "Hide password" : "Show password"}
                  aria-pressed={shown}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-slate-400 hover:text-slate-700"
                >
                  {shown ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                </button>
              </div>
              {problem && (
                <p id="login-error" role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {problem.message}
                </p>
              )}
              <button
                type="submit"
                disabled={busy}
                className="mt-6 flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#047857] px-4 text-sm font-semibold text-white shadow-[0_6px_16px_-6px_rgba(4,120,87,0.5)] transition-colors hover:bg-[#065f46] disabled:cursor-wait disabled:opacity-60"
              >
                <span>{busy ? "Signing in…" : "Open my workspace"}</span>
                {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <ArrowRight aria-hidden="true" className="size-4" />}
              </button>
              <p className="mt-3 text-xs leading-5 text-slate-500">Need access or a new password? Contact your administrator.</p>
            </form>
          </div>
        </div>
        <footer className="text-center text-[11px] text-slate-400">2MG Inc. · Your company workspace</footer>
      </section>
    </main>
  );
}
