import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiFailure, api } from "../api";
import { ME, useMe } from "../auth";

export function ChangePassword() {
  const me = useMe().data;
  const queries = useQueryClient();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const first = me?.mustChangePassword;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; field?: string } | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    if (next !== again) {
      setBusy(false);
      setProblem({ message: "The two passwords don't match.", field: "again" });
      return;
    }
    try {
      await api("/api/auth/password", { body: { current, next } });
      await queries.invalidateQueries({ queryKey: ME });
      // The first password of their own: straight on to their work.
      if (first) return navigate("/", { replace: true });
      setAgain("");
      setDone(true);
      setCurrent("");
      setNext("");
    } catch (error) {
      setProblem(
        error instanceof ApiFailure
          ? { message: error.message, field: error.field }
          : { message: "Couldn't change it. Try again." },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto flex w-full max-w-sm flex-col gap-4 rounded-xl border border-line bg-white p-6 shadow-card"
    >
      <h1 className="text-xl font-bold text-ink">{first ? "Choose your password" : "Change password"}</h1>
      {me?.mustChangePassword && (
        <div className="rounded-lg bg-warn-tint px-3 py-2.5 text-warn">
          Choose a password only you know. You need it before you start.
        </div>
      )}
      <Field
        id="current"
        label={first ? "One-time password you were given" : "Current password"}
        value={current}
        onChange={setCurrent}
        autoComplete="current-password"
        error={problem?.field === "current" ? problem.message : undefined}
      />
      <Field
        id="next"
        label="New password (8 characters or more)"
        value={next}
        onChange={setNext}
        autoComplete="new-password"
        error={problem?.field === "next" ? problem.message : undefined}
      />
      <Field
        id="again"
        label="New password again"
        value={again}
        onChange={setAgain}
        autoComplete="new-password"
        error={problem?.field === "again" ? problem.message : undefined}
      />
      {problem && !problem.field && (
        <div role="alert" className="rounded-lg bg-bad-tint px-3 py-2.5 text-bad">
          {problem.message}
        </div>
      )}
      {done && (
        <div role="status" className="rounded-lg bg-good-tint px-3 py-2.5 text-good">
          Password changed. Your other devices were signed out.
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="h-11 flex-1 rounded-lg bg-brand font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Saving…" : "Change password"}
        </button>
        {first ? (
          <button
            type="button"
            onClick={async () => {
              await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
              queries.setQueryData(ME, null);
              navigate("/signin", { replace: true });
            }}
            className="h-11 rounded-lg border border-field px-4"
          >
            Sign out
          </button>
        ) : (
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="h-11 rounded-lg border border-field px-4"
          >
            Back
          </button>
        )}
      </div>
    </form>
  );
}

function Field(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={props.id} className="text-xs font-medium text-ink-2">
        {props.label}
      </label>
      <input
        id={props.id}
        type="password"
        required
        autoComplete={props.autoComplete}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        aria-invalid={Boolean(props.error)}
        aria-describedby={props.error ? `${props.id}-error` : undefined}
        className="h-11 rounded-lg border border-field bg-white px-3"
      />
      {props.error && (
        <div id={`${props.id}-error`} className="text-[13px] text-bad">
          {props.error}
        </div>
      )}
    </div>
  );
}
