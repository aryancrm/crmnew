// The acceptance email's link (/welcome#<token>): set the password, then sign in as everyone does.
// The token is after #, so no server logs it, and it leaves the address bar as soon as it is read.

import type { WelcomeInfo } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { CircleCheck, LoaderCircle } from "lucide-react";
import { type FormEvent, useEffect, useLayoutEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiFailure, api } from "../api";
import { ME } from "../auth";
import { useAction } from "../ui";
import { Alert, Heading, MAIN_BUTTON, PublicPage, TextField } from "./public-page";

/** The company a link of another company than the first names (`?org=`, its Org ID). */
const orgOf = (search: string) => {
  const org = new URLSearchParams(search).get("org") ?? "";
  return /^[1-9][0-9]{5}$/.test(org) ? org : "";
};

export function Welcome() {
  const { hash, search } = useLocation();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const action = useAction();
  const [token, setToken] = useState(() => hash.slice(1));
  const [org, setOrg] = useState(() => orgOf(search));
  const at = (path: string) => (org ? `${path}?org=${org}` : path);
  const [info, setInfo] = useState<WelcomeInfo | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const [done, setDone] = useState(false);

  // Before anything that reports the page's address can read it.
  useLayoutEffect(() => {
    if (!hash) return;
    // Another link opened in the same tab.
    setToken(hash.slice(1));
    setOrg(orgOf(window.location.search));
    window.history.replaceState(window.history.state, "", "/welcome");
  }, [hash]);

  useEffect(() => {
    setInfo(null);
    setDead(null);
    setDone(false);
    if (!token) {
      setDead("Open the link in your acceptance email again.");
      return;
    }
    let here = true;
    api<WelcomeInfo>(at("/api/auth/welcome"), { body: { token } })
      .then((answer) => here && setInfo(answer))
      .catch((error) => {
        if (!here) return;
        setDead(
          error instanceof ApiFailure && error.code !== "invalid"
            ? error.message
            : "This link isn't whole. Copy all of it from your email.",
        );
      });
    return () => {
      here = false;
    };
  }, [token, org]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMismatch(password !== again);
    if (password !== again) return;
    const ok = await action.run(async () => {
      await api(at("/api/auth/welcome/password"), { body: { token, password } });
    });
    if (!ok) return;
    setPassword("");
    setAgain("");
    setDone(true);
  }

  async function signIn() {
    // Whoever was signed in on this browser (the Admin who passed the link on, say) isn't this person.
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    await queries.cancelQueries();
    queries.setQueryData(ME, null);
    queries.removeQueries({ predicate: (query) => query.queryKey[0] !== ME[0] });
    navigate(info?.department ? `/login/${info.department}` : "/login", { replace: true, state: { loginId: info?.email } });
  }

  return (
    <PublicPage>
      {dead ? (
        <>
          <Heading title="This link can't be used" />
          <div className="mt-3">
            <Alert message={dead} />
          </div>
          <Link to="/login" className={`${MAIN_BUTTON} mt-6`}>
            Go to sign in
          </Link>
        </>
      ) : !info ? (
        <p role="status" className="flex items-center gap-2 text-[15px] text-[#5b6472]">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Checking your link…
        </p>
      ) : done ? (
        <div role="status">
          <CircleCheck className="mb-4 size-10 text-[#1f9d55]" aria-hidden="true" />
          <Heading title="Your account is ready">Sign in with your email and the password you just set.</Heading>
          <dl className="mt-5 grid gap-3 rounded-xl bg-[#f6f7fb] p-4">
            <div>
              <dt className="text-xs text-[#5b6472]">Login</dt>
              <dd className="text-[15px] font-semibold break-all">{info.email}</dd>
            </div>
            {info.seatLogin && (
              <div>
                <dt className="text-xs text-[#5b6472]">Or your seat's login ID</dt>
                <dd className="text-[15px] font-semibold break-all">{info.seatLogin}</dd>
              </div>
            )}
          </dl>
          <button type="button" onClick={signIn} className={`${MAIN_BUTTON} mt-6`}>
            Sign in
          </button>
        </div>
      ) : (
        <>
          <Heading title={`Welcome, ${info.firstName}`}>Your account is accepted. Set your password to use it.</Heading>
          <form onSubmit={submit} className="mt-6 grid gap-4">
            <input type="email" autoComplete="username" value={info.email} readOnly hidden />
            <TextField
              label="Password (8 characters or more)"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onValue={setPassword}
              error={action.at("password")}
            />
            <TextField
              label="Password again"
              type="password"
              autoComplete="new-password"
              required
              value={again}
              onValue={setAgain}
              error={mismatch ? "The two passwords don't match." : undefined}
            />
            <Alert message={action.general(["password"])} />
            <button type="submit" disabled={action.busy} className={`${MAIN_BUTTON} mt-2`}>
              {action.busy ? "Saving…" : "Set password"}
            </button>
          </form>
        </>
      )}
    </PublicPage>
  );
}
