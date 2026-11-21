// On a desk's common screen (Aryan, 21 Nov) the screen itself only reads: anything done on it asks
// who is doing it (their name and their own PIN), and is done in their name. The name and PIN are
// kept for two idle minutes; the bar at the bottom says who is acting and lets them finish.

import type { DeskDuty } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, KeyRound, UserRound, X } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { api, type DeskActor, setDeskActor, setDeskAsk, watchDeskActor } from "../api";

type Asking = { message: string | null; personId?: number; done: (one: DeskActor | null) => void };

export function DeskPinPrompt({ desk }: { desk: DeskDuty["desk"] }) {
  const [asking, setAsking] = useState<Asking | null>(null);
  const [acting, setActing] = useState<DeskActor | null>(null);
  useEffect(() => watchDeskActor(setActing), []);
  useEffect(() => {
    setDeskAsk((why) => new Promise((done) => setAsking({ ...why, done })));
    return () => {
      setDeskAsk(null);
      setDeskActor(null);
    };
  }, []);

  return (
    <>
      {acting && !asking && (
        <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-slate-200 bg-white py-1.5 pr-1.5 pl-4 text-sm shadow-lg print:hidden">
          <UserRound className="size-4 text-slate-500" aria-hidden="true" />
          <span>
            Acting as <strong className="font-semibold">{acting.name}</strong>
          </span>
          <button
            type="button"
            onClick={() => setDeskActor(null)}
            className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700"
          >
            Done
          </button>
        </div>
      )}
      {asking && (
        <WhoBox
          desk={desk}
          asking={asking}
          close={(one) => {
            asking.done(one);
            setAsking(null);
          }}
        />
      )}
    </>
  );
}

function WhoBox({ desk, asking, close }: { desk: DeskDuty["desk"]; asking: Asking; close: (one: DeskActor | null) => void }) {
  const team = useQuery({ queryKey: ["desk", desk, "team"], queryFn: () => api<DeskDuty>(`/api/desk/${desk}/team`) });
  const [personId, setPersonId] = useState<number | null>(asking.personId ?? null);
  const [pin, setPin] = useState("");
  const pinRef = useRef<HTMLInputElement>(null);
  const ids = useId();
  const people = team.data?.people ?? [];
  const chosen = people.find((one) => one.id === personId) ?? null;
  // The one who must do it (Start is pressed by oneself) can't be changed.
  const fixed = asking.personId !== undefined;

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(null);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [close]);
  useEffect(() => {
    if (chosen) pinRef.current?.focus();
  }, [chosen]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!chosen || pin.length < 4) return;
    close({ id: chosen.id, name: chosen.name, pin });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/30 p-4 backdrop-blur-sm">
      <button type="button" aria-label="Cancel" className="absolute inset-0 cursor-default" onClick={() => close(null)} />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
        onSubmit={submit}
        className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
      >
        <button type="button" onClick={() => close(null)} aria-label="Cancel" className="absolute top-3 right-3 grid size-8 place-items-center rounded-full text-slate-500 hover:bg-slate-100">
          <X className="size-4" />
        </button>
        <h2 id={`${ids}-title`} className="text-lg font-semibold text-slate-900">
          {fixed && chosen ? `Start ${chosen.name}` : "Who is doing this?"}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {fixed ? "Each person starts themselves with their own PIN." : "Select your name and enter your PIN. It's recorded in your name."}
        </p>

        {!fixed && (
          <fieldset className="mt-4">
            <legend className="text-[13px] font-semibold text-slate-900">Your name</legend>
            <div className="mt-1.5 grid max-h-56 gap-1 overflow-y-auto">
              {people.map((one) => (
                <label
                  key={one.id}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm ${personId === one.id ? "border-orange-500 bg-orange-50" : "border-slate-200 hover:bg-slate-50"}`}
                >
                  <input type="radio" name="who" className="sr-only" checked={personId === one.id} onChange={() => setPersonId(one.id)} />
                  <span className="font-medium text-slate-900">{one.name}</span>
                  {one.title && <span className="truncate text-xs text-slate-500">{one.title}</span>}
                </label>
              ))}
              {team.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
            </div>
          </fieldset>
        )}

        <label htmlFor={`${ids}-pin`} className="mt-4 block text-[13px] font-semibold text-slate-900">
          PIN
        </label>
        <div className="relative mt-1.5">
          <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            ref={pinRef}
            id={`${ids}-pin`}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
            aria-invalid={asking.message ? true : undefined}
            aria-describedby={asking.message ? `${ids}-error` : undefined}
            className="h-11 w-full rounded-xl border border-slate-300 pr-3 pl-9 text-lg tracking-[0.4em] outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-500/15 aria-[invalid=true]:border-rose-500"
          />
        </div>
        {asking.message && (
          <p id={`${ids}-error`} role="alert" className="mt-1.5 flex items-center gap-1.5 text-[13px] text-rose-700">
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" /> {asking.message}
          </p>
        )}
        <button
          type="submit"
          disabled={!chosen || pin.length < 4}
          className="mt-5 h-11 w-full rounded-xl bg-orange-600 text-sm font-semibold text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continue
        </button>
        <p className="mt-3 text-xs text-slate-500">Forgot your PIN? Ask the administrator to clear it, then set a new one at Personal login.</p>
      </form>
    </div>
  );
}
