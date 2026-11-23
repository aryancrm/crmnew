// Profile > Security: two-step sign-in, the password, the other devices, what was done lately.

import type { Profile } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { ME } from "../auth";
import { Button, Pill, Problem, timeLabel, useAction } from "../ui";
import { PROFILE, Section } from "./profile-parts";
import { NewRecoveryCodes, SetUpTwoStep, TurnOffTwoStep } from "./two-step";

const OUTLINE = "border border-slate-300 bg-white";

function Row({ title, note, action }: { title: ReactNode; note: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">{title}</h3>
        <div className="mt-0.5 text-sm text-ink-2">{note}</div>
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
  );
}

export function ProfileSecurity({ security }: { security: Profile["security"] }) {
  const [asking, setAsking] = useState<"on" | "off" | "codes" | null>(null);
  const queries = useQueryClient();
  const devices = useAction();
  const { twoStep, otherSessions, events, lastSignIn } = security;

  async function refresh() {
    await Promise.all([queries.invalidateQueries({ queryKey: PROFILE }), queries.invalidateQueries({ queryKey: ME })]);
  }
  function closed() {
    setAsking(null);
    void refresh();
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Section title="Sign-in">
        <div className="divide-y divide-slate-100">
          <Row
            title={
              <>
                Two-step sign-in <Pill tone={twoStep.on ? "good" : "warn"}>{twoStep.on ? "On" : "Off"}</Pill>
              </>
            }
            note={
              twoStep.on
                ? "Each sign-in asks for a code from your authenticator app."
                : "Add a code from your phone, so a stolen password alone can't open your account."
            }
            action={
              twoStep.on ? (
                <Button key="off" variant="danger" onClick={() => setAsking("off")}>
                  Turn off
                </Button>
              ) : (
                <Button key="on" variant="primary" onClick={() => setAsking("on")}>
                  Set up
                </Button>
              )
            }
          />
          {twoStep.on && (
            <Row
              title="Recovery codes"
              note={
                <span className={twoStep.codesLeft <= 3 ? "font-semibold text-warn" : ""}>
                  {twoStep.codesLeft} of 10 left. They sign you in if you lose your phone.
                </span>
              }
              action={
                <Button className={OUTLINE} onClick={() => setAsking("codes")}>
                  Make new codes
                </Button>
              }
            />
          )}
          <Row
            title="Password"
            note="Changing it signs out your other devices."
            action={
              <Link
                to="/password"
                className={`inline-flex h-10 items-center rounded-[10px] px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 pointer-coarse:h-11 ${OUTLINE}`}
              >
                Change password
              </Link>
            }
          />
          <Row
            title="Other devices"
            note={
              <>
                {otherSessions
                  ? `Signed in on ${otherSessions} other ${otherSessions === 1 ? "device" : "devices"}.`
                  : "Signed in only here."}
                {lastSignIn && ` Last sign-in ${timeLabel(lastSignIn)}.`}
                <Problem message={devices.problem?.message} />
              </>
            }
            action={
              otherSessions > 0 && (
                <Button
                  className={OUTLINE}
                  disabled={devices.busy}
                  onClick={() =>
                    devices.run(async () => {
                      await api("/api/auth/sessions/end-others", { body: {} });
                      await refresh();
                    })
                  }
                >
                  Sign out other devices
                </Button>
              )
            }
          />
        </div>
      </Section>

      <Section title="Recent activity">
        {events.length ? (
          <ul className="flex flex-col gap-3">
            {events.map((event) => (
              <li key={event.id}>
                <div className="text-sm font-medium text-ink">{event.what}</div>
                {event.detail && <div className="text-xs wrap-break-word text-ink">{event.detail}</div>}
                <div className="text-xs text-ink-2">
                  {timeLabel(event.at)}
                  {event.by ? ` · by ${event.by}` : ""}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-2">Changes to your account show here.</p>
        )}
      </Section>

      {asking === "on" && <SetUpTwoStep onClose={closed} />}
      {asking === "off" && <TurnOffTwoStep onClose={closed} />}
      {asking === "codes" && <NewRecoveryCodes onClose={closed} />}
    </div>
  );
}
