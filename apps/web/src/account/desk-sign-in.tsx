// Management's, Finance's and Dispatch's sign-in with the desks' common password (Aryan, 19 Nov;
// back on 27 Nov: "Management, Finance and Dispatch had a common password only, bring it back").
// The desk's page opens with the password alone (the desk's shared screen); "Sign in with my own ID
// instead" stays under it. Only while the company's Admin has set the desks' password (Admin panel);
// else the page is the usual sign-in.

import type { Me } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiFailure, api } from "../api";
import { ME } from "../auth";
import { rememberWorkspace, type Workspace } from "../workspaces";
import { markActive } from "./idle";

/** The desks that open with the desks' common password. */
export const DESK_KEYS: readonly string[] = ["management", "finance", "dispatch"];

const FIELD =
  "h-11 w-full rounded-full border border-[#d5d9e1] bg-white px-5 pr-12 text-[14px] text-[#1f2733] shadow-none outline-none transition-[border-color,outline-color] placeholder:text-[#6b7380] hover:border-[#b9bfcb] focus:border-[#f36b21] focus:outline-solid! focus:outline-2! focus:outline-offset-2! focus:outline-[#f36b21]! disabled:bg-[#f6f7f9] aria-[invalid=true]:border-rose-500";
const LINK = "inline-flex min-h-11 items-center font-semibold text-[#c2410c] hover:underline";

/** The desk's page: the desks' password first when it is set, a person's own login a press away. */
export function DeskOrOwn({ workspace, own }: { workspace: Workspace; own: ReactNode }) {
  const open = useQuery({
    queryKey: ["auth", "desk"],
    queryFn: () => api<{ on: boolean }>("/api/auth/desk"),
    staleTime: 60_000,
  });
  const [mine, setMine] = useState(false);
  if (open.isPending) return <div className="min-h-64" aria-busy="true" />;
  if (!open.data?.on) return <>{own}</>;
  if (mine)
    return (
      <>
        {own}
        <button type="button" onClick={() => setMine(false)} className={`${LINK} text-[12.5px]`}>
          Use the desk password instead
        </button>
      </>
    );
  return <DeskSignIn workspace={workspace} onOwn={() => setMine(true)} />;
}

function DeskSignIn({ workspace, onOwn }: { workspace: Workspace; onOwn: () => void }) {
  const queries = useQueryClient();
  const navigate = useNavigate();
  const ids = useId();
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const { me } = await api<{ me: Me }>("/api/auth/desk", { body: { desk: workspace.key, password } });
      markActive();
      queries.setQueryData(ME, me);
      rememberWorkspace(workspace.key);
      navigate("/", { replace: true });
    } catch (error) {
      setProblem(error instanceof ApiFailure ? error.message : "Couldn't open the desk. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full text-left">
      <h1 className="text-[clamp(24px,2.4vw,28px)] leading-tight font-semibold tracking-[-0.03em] text-[#1f2733]">
        {`Sign in to ${workspace.label}`}
      </h1>
      <form onSubmit={submit} className="mt-5 grid gap-3.5" aria-busy={busy}>
        <div className="grid gap-1.5">
          <label htmlFor={`${ids}-password`} className="text-[12.5px] font-semibold text-[#1f2733]">
            Desk password
          </label>
          <div className="relative">
            <input
              id={`${ids}-password`}
              type={shown ? "text" : "password"}
              placeholder="Enter the desk password"
              autoComplete="current-password"
              required
              disabled={busy}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setProblem(null);
              }}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${ids}-error` : undefined}
              className={FIELD}
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
          {problem && (
            <p id={`${ids}-error`} role="alert" className="flex items-start gap-1.5 text-[13px] text-rose-700">
              <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" /> {problem}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={busy}
          className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#f36b21] text-[14px] font-semibold text-white transition-colors hover:bg-[#e05a12] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f36b21] disabled:cursor-wait disabled:opacity-70"
        >
          {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <div className="mt-5 grid gap-1 border-t border-[#eceef3] pt-2 text-[12.5px] text-[#5b6472]">
        <button type="button" onClick={onOwn} className={`${LINK} w-fit`}>
          Sign in with my own ID instead
        </button>
        <p>Forgot the desk password? Ask your administrator.</p>
      </div>
    </div>
  );
}
