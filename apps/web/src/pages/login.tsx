import type { Me } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiFailure, api } from "../api";
import { ME, useMe } from "../auth";
import { OrbitBackdrop, WORKSPACE_ART } from "../portal/art";
import { lastWorkspace, rememberWorkspace, WORKSPACES, workspaceOf } from "../workspaces";

export function Login() {
  const me = useMe();
  const queries = useQueryClient();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  // The workspace picked on the board (only a look: the login decides what opens).
  const [workspace, setWorkspace] = useState<string | null>(null);
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
      rememberWorkspace(workspaceOf(signedIn).key);
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

  const picked = WORKSPACES.find((one) => one.key === workspace) ?? null;
  const last = lastWorkspace();
  const Art = picked ? WORKSPACE_ART[picked.key] : null;

  return (
    <main className="grid min-h-dvh bg-[#f7f4ef] lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)]">
      {/* The front door: Bishnoi One, and whose company this is. */}
      <section className="relative isolate flex flex-col justify-between gap-6 overflow-hidden bg-[#0f1a14] px-6 py-7 text-[#f3efe6] sm:px-10 lg:py-10 xl:px-14">
        <OrbitBackdrop />
        <div className="flex items-center gap-3">
          <img src="/brand/bishnoi-one-mark.png" alt="" className="size-10" />
          <span className="text-lg font-semibold tracking-tight">Bishnoi One</span>
        </div>
        <div className="relative max-w-md">
          <img src="/brand/bishnoi-one-512.png" alt="Bishnoi One" className="mb-6 hidden size-36 drop-shadow-[0_18px_40px_rgba(255,106,26,0.25)] lg:block xl:size-44" />
          <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#e9a77f]">Company portal</p>
          <h1 className="mt-3 font-serif text-[2.1rem] leading-[1.12] tracking-tight xl:text-[2.6rem]">
            One company.
            <br />
            <span className="text-[#ff8a4c]">Every department</span> in one place.
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-6 text-[#b9c4bb]">
            Choose your workspace and sign in as yourself. Sales, management, finance, stock, dispatch and people, working
            from the same records.
          </p>
        </div>
        <div className="relative hidden items-center justify-between border-t border-white/10 pt-4 text-[11px] text-[#9fb0a4] lg:flex">
          <span>2MG Inc. · GetMeds Philippines Inc.</span>
          <span className="flex items-center gap-1.5">
            <LockKeyhole className="size-3" aria-hidden="true" /> Each person signs in as themselves
          </span>
        </div>
      </section>

      <section className="flex min-w-0 flex-col px-5 py-6 sm:px-10 lg:px-12 lg:py-10">
        {!picked ? (
          /* The workspace board. */
          <div className="mx-auto w-full max-w-4xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#c25a1d]">Bishnoi One</p>
            <h2 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-[#14201a] sm:text-[32px]">Choose your workspace</h2>
            <p className="mt-1.5 text-sm text-[#5b675f]">Your own login opens the work that is yours, as always.</p>
            <ul className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {WORKSPACES.map((one) => {
                const Scene = WORKSPACE_ART[one.key];
                return (
                  <li key={one.key}>
                    <button
                      type="button"
                      onClick={() => {
                        setWorkspace(one.key);
                        setProblem(null);
                      }}
                      className="group relative flex w-full flex-col overflow-hidden rounded-2xl border border-[#e7e1d6] bg-white text-left shadow-[0_1px_0_rgba(20,32,26,0.04)] transition hover:-translate-y-0.5 hover:border-[#f0b48c] hover:shadow-[0_18px_40px_-22px_rgba(194,90,29,0.45)] focus-visible:outline-2 focus-visible:outline-[#ff6a1a]"
                    >
                      <span className="block aspect-[160/112] w-full p-1.5">{Scene && <Scene />}</span>
                      <span className="block px-3.5 pt-1 pb-3">
                        <span className="block text-[15px] font-semibold text-[#14201a]">{one.label}</span>
                        <span className="block text-xs leading-snug text-[#6b766e]">{one.about}</span>
                      </span>
                      {last === one.key && (
                        <span className="absolute top-3 left-3 rounded-full bg-[#14201a] px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white">Last used</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          /* Signing in to the workspace picked. */
          <div className="mx-auto my-auto w-full max-w-[440px] py-6">
            <button
              type="button"
              onClick={() => setWorkspace(null)}
              className="mb-4 flex items-center gap-1.5 text-sm font-medium text-[#5b675f] hover:text-[#14201a]"
            >
              <ArrowLeft className="size-4" aria-hidden="true" /> All workspaces
            </button>
            <div className="overflow-hidden rounded-3xl border border-[#e7e1d6] bg-white shadow-[0_24px_70px_-30px_rgba(20,32,26,0.35)]">
              <div className="h-36 w-full bg-[#fff7ef] p-2">{Art && <Art />}</div>
              <div className="p-6 sm:p-8">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#c25a1d]">{picked.label} workspace</p>
                <h2 className="mt-1.5 text-[24px] font-semibold leading-tight tracking-tight text-[#14201a]">Sign in as yourself</h2>
                <p className="mt-1 text-sm text-[#5b675f]">Your login ID and password, as always.</p>
                <form onSubmit={submit} className="mt-6" aria-busy={busy}>
                  <label htmlFor="email" className="text-xs font-semibold text-[#2c3a31]">Login ID</label>
                  <input
                    id="email"
                    type="text"
                    placeholder="hos1, tl1 or name@2mginc.com"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoComplete="username"
                    // biome-ignore lint/a11y/noAutofocus: the workspace was just picked to sign in
                    autoFocus
                    required
                    disabled={busy}
                    value={email}
                    onChange={(event) => { setEmail(event.target.value); setProblem(null); }}
                    aria-invalid={problem?.field === "email"}
                    className="mt-2 h-12 w-full rounded-xl border border-[#d9d2c5] bg-[#fdfbf8] px-3.5 text-base outline-none transition focus:border-[#ff6a1a] focus:bg-white focus:ring-4 focus:ring-[#ff6a1a]/15 sm:text-sm"
                  />
                  <label htmlFor="password" className="mt-4 block text-xs font-semibold text-[#2c3a31]">Password</label>
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
                      className="h-12 w-full rounded-xl border border-[#d9d2c5] bg-[#fdfbf8] pl-3.5 pr-12 text-base outline-none transition focus:border-[#ff6a1a] focus:bg-white focus:ring-4 focus:ring-[#ff6a1a]/15 sm:text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShown((value) => !value)}
                      aria-label={shown ? "Hide password" : "Show password"}
                      aria-pressed={shown}
                      className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-[#8a948c] hover:text-[#14201a]"
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
                    className="mt-6 flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#14201a] px-4 text-sm font-semibold text-white shadow-[0_10px_24px_-12px_rgba(20,32,26,0.7)] transition-colors hover:bg-[#ff6a1a] disabled:cursor-wait disabled:opacity-60"
                  >
                    <span>{busy ? "Signing in…" : `Enter ${picked.label}`}</span>
                    {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <ArrowRight aria-hidden="true" className="size-4" />}
                  </button>
                  <p className="mt-3 text-xs leading-5 text-[#6b766e]">Need access or a new password? Contact your administrator.</p>
                </form>
              </div>
            </div>
          </div>
        )}
        <footer className="mt-8 text-center text-[11px] text-[#9a9f98]">Bishnoi One · 2MG Inc. company portal</footer>
      </section>
    </main>
  );
}
