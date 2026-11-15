import type { Me } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiFailure, api } from "../api";
import { ME, useMe } from "../auth";

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
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-3xl font-bold text-brand">2MG</div>
          <div className="mt-1 text-ink-2">Orders, stock and sales in one place</div>
        </div>
        <form
          onSubmit={submit}
          className="flex flex-col gap-4 rounded-xl border border-line bg-white p-6 shadow-card"
        >
          <h1 className="text-xl font-bold">Sign in</h1>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-xs font-medium text-ink-2">
              Login ID
            </label>
            <input
              id="email"
              type="text"
              placeholder="hos1, tl1 or your email"
              autoCapitalize="none"
              spellCheck={false}
              autoComplete="username"
              // biome-ignore lint/a11y/noAutofocus: the sign-in page has one job
              autoFocus
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={problem?.field === "email"}
              className="h-11 rounded-lg border border-field bg-white px-3"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-xs font-medium text-ink-2">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={shown ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={problem?.field === "password"}
                className="field pr-12 pl-3"
              />
              <button
                type="button"
                onClick={() => setShown((value) => !value)}
                aria-label={shown ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-2"
              >
                {shown ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
          {problem && (
            <div role="alert" className="rounded-lg bg-bad-tint px-3 py-2.5 text-bad">
              {problem.message}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="h-12 rounded-lg bg-brand text-base font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
