// The head's HQs on the Headquarters page (Aryan, 28 Nov: "do you think the Admin should make the HQs
// and not Javed?"; his plan's phase 4, PLAN 264): a new HQ in a channel, who works an HQ (someone put
// in, moved from another HQ, or nobody), its new name, and closing an empty one. Each says what it
// does to the people in it before it is saved: who is left without an HQ, which HQ is left empty, and
// the sign-in ID the person uses from today (it goes with the HQ; their password stays their own).

import type { Headquarters, HqPeople } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../api";
import { Button, Dialog, Field, INPUT, Problem, useAction } from "../ui";

type Channel = Headquarters["channels"][number];
type Hq = Channel["hqs"][number];
type Person = HqPeople["people"][number];

function usePeople() {
  return useQuery({ queryKey: ["headquarters", "people"], queryFn: () => api<HqPeople>("/api/headquarters/people") });
}

/** Every screen reading the HQs reads them again: this page, the Home's tree, the team's figures. */
function useSaved() {
  const queries = useQueryClient();
  return () => queries.invalidateQueries();
}

const day = (value: string) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const whereOf = (person: Person) => (person.seatId ? [person.hq, person.team].filter(Boolean).join(" · ") : "no HQ now");

function Footer({ busy, label, onClose, danger }: { busy: boolean; label: string; onClose: () => void; danger?: boolean }) {
  return (
    <div className="mt-1 flex justify-end gap-2 border-t border-slate-100 pt-4">
      <Button onClick={onClose} disabled={busy}>
        Cancel
      </Button>
      <Button type="submit" variant={danger ? "danger" : "primary"} disabled={busy}>
        {busy ? "Saving…" : label}
      </Button>
    </div>
  );
}

/** The people to pick from, with the HQ each works now. */
function PersonSelect({
  value,
  onChange,
  people,
  empty,
  except,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  people: Person[] | undefined;
  /** The "nobody" choice's words. */
  empty: string;
  except?: number | null;
  error?: string;
}) {
  return (
    <Field label="Who works it" error={error}>
      {(field) => (
        <select {...field} value={value} onChange={(event) => onChange(event.target.value)} className={INPUT}>
          <option value="">{people ? empty : "Reading the people…"}</option>
          {(people ?? [])
            .filter((one) => one.id !== except)
            .map((one) => (
              <option key={one.id} value={one.id}>
                {one.name} — {whereOf(one)}
              </option>
            ))}
        </select>
      )}
    </Field>
  );
}

/** What a move does, in a line each. */
function Effects({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <ul className="space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-700">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

/** "Marwin Dy leaves TAFT: it will be empty." */
const leaves = (person: Person | undefined) =>
  person?.seatId && person.hq ? [`${person.name} leaves ${person.hq}: it will be empty.`] : [];

/** The channel's "New HQ" button and its form. */
export function NewHq({ channel, onMade }: { channel: Channel; onMade: (seatId: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button small variant="primary" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" aria-hidden="true" /> New HQ
      </Button>
      {open && (
        <NewHqDialog
          channel={channel}
          onClose={() => setOpen(false)}
          onMade={(seatId) => {
            setOpen(false);
            onMade(seatId);
          }}
        />
      )}
    </>
  );
}

function NewHqDialog({ channel, onClose, onMade }: { channel: Channel; onClose: () => void; onMade: (seatId: number) => void }) {
  const people = usePeople().data?.people;
  const saved = useSaved();
  const action = useAction();
  const [name, setName] = useState("");
  const [personId, setPersonId] = useState("");
  const person = people?.find((one) => String(one.id) === personId);
  const hq = name.trim().toUpperCase() || "the new HQ";

  async function submit(event: FormEvent) {
    event.preventDefault();
    let seatId = 0;
    const done = await action.run(async () => {
      seatId = (
        await api<{ seatId: number }>("/api/headquarters", {
          body: { unitId: channel.unitId, name, personId: personId ? Number(personId) : null },
        })
      ).seatId;
    });
    if (done) {
      await saved();
      onMade(seatId);
    }
  }

  return (
    <Dialog
      title={`New HQ in ${channel.name}`}
      sub="Made like the channel's other HQs, with its own sign-in ID: whoever works it signs in with it."
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="HQ name *" error={action.at("name")}>
          {(field) => (
            <input
              {...field}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={INPUT}
              placeholder="MAKATI"
              maxLength={40}
              required
            />
          )}
        </Field>
        <PersonSelect value={personId} onChange={setPersonId} people={people} empty="Nobody yet: leave it empty" error={action.at("personId")} />
        <Effects lines={person ? [...leaves(person), `${person.name} works ${hq} from today.`] : []} />
        <Problem message={action.general(["name", "personId"])} />
        <Footer busy={action.busy} label="Make the HQ" onClose={onClose} />
      </form>
    </Dialog>
  );
}

/** The picked HQ's buttons: who works it, its name, closing it when empty. */
export function HqTools({ hq, onClosed }: { hq: Hq; onClosed: () => void }) {
  const [open, setOpen] = useState<"person" | "rename" | "close" | null>(null);
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <Button small variant="quiet" className="border border-slate-200" onClick={() => setOpen("person")}>
        {hq.person ? "Change person" : "Put someone in"}
      </Button>
      <Button small variant="quiet" className="border border-slate-200" onClick={() => setOpen("rename")}>
        Rename
      </Button>
      {!hq.person && (
        <Button small variant="danger" className="border border-rose-200" onClick={() => setOpen("close")}>
          Close HQ
        </Button>
      )}
      {open === "person" && <PersonDialog hq={hq} onClose={() => setOpen(null)} />}
      {open === "rename" && <RenameDialog hq={hq} onClose={() => setOpen(null)} />}
      {open === "close" && (
        <CloseDialog
          hq={hq}
          onClose={() => setOpen(null)}
          onClosed={() => {
            setOpen(null);
            onClosed();
          }}
        />
      )}
    </div>
  );
}

const NOBODY = "nobody";

function PersonDialog({ hq, onClose }: { hq: Hq; onClose: () => void }) {
  const people = usePeople().data?.people;
  const saved = useSaved();
  const action = useAction();
  const [choice, setChoice] = useState("");
  const person = people?.find((one) => String(one.id) === choice);
  const nobody = choice === NOBODY;
  const lines = [
    ...(hq.person && (person || nobody) ? [`${hq.person} steps out of ${hq.hq}: no HQ until you put them in one.`] : []),
    ...leaves(person),
    ...(person ? [`${person.name} works ${hq.hq} from today${hq.login ? ` and signs in with its ID, ${hq.login}, with their own password` : ""}.`] : []),
    ...(person || nobody ? [`${hq.hq}'s customers, doctors and orders stay with it; the CRM keeps who worked it before.`] : []),
  ];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!choice) return;
    const done = await action.run(async () => {
      await api(`/api/headquarters/${hq.seatId}/person`, { body: { personId: nobody ? null : Number(choice) } });
    });
    if (done) {
      await saved();
      onClose();
    }
  }

  return (
    <Dialog
      title={`Who works ${hq.hq}`}
      sub={hq.person ? `Now: ${hq.person}${hq.since ? `, since ${day(hq.since)}` : ""}.` : "Nobody works it now."}
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Who works it from today *" error={action.at("personId")}>
          {(field) => (
            <select {...field} value={choice} onChange={(event) => setChoice(event.target.value)} className={INPUT} required>
              <option value="">{people ? "Pick someone…" : "Reading the people…"}</option>
              {hq.person && <option value={NOBODY}>Nobody: leave {hq.hq} empty</option>}
              {(people ?? [])
                .filter((one) => one.id !== hq.personId)
                .map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.name} — {whereOf(one)}
                  </option>
                ))}
            </select>
          )}
        </Field>
        <Effects lines={lines} />
        <Problem message={action.general(["personId"])} />
        <Footer busy={action.busy} label="Save" onClose={onClose} />
      </form>
    </Dialog>
  );
}

function RenameDialog({ hq, onClose }: { hq: Hq; onClose: () => void }) {
  const saved = useSaved();
  const action = useAction();
  const [name, setName] = useState(hq.hq);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(async () => {
      await api(`/api/headquarters/${hq.seatId}`, { method: "PATCH", body: { name } });
    });
    if (done) {
      await saved();
      onClose();
    }
  }

  return (
    <Dialog title={`Rename ${hq.hq}`} sub="Its person, customers, doctors, orders and sign-in ID stay with it." onClose={onClose} busy={action.busy}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="HQ name *" error={action.at("name")}>
          {(field) => (
            <input {...field} value={name} onChange={(event) => setName(event.target.value)} className={INPUT} maxLength={40} required />
          )}
        </Field>
        <Problem message={action.general(["name"])} />
        <Footer busy={action.busy} label="Rename" onClose={onClose} />
      </form>
    </Dialog>
  );
}

function CloseDialog({ hq, onClose, onClosed }: { hq: Hq; onClose: () => void; onClosed: () => void }) {
  const saved = useSaved();
  const action = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(async () => {
      await api(`/api/headquarters/${hq.seatId}/close`, { method: "POST" });
    });
    if (done) {
      await saved();
      onClosed();
    }
  }

  return (
    <Dialog title={`Close ${hq.hq}`} sub="Nobody works it." onClose={onClose} busy={action.busy}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-[13px] text-slate-700">
          {hq.hq} goes off the Headquarters page. Its {hq.customers.toLocaleString("en-PH")} customer{hq.customers === 1 ? "" : "s"} and its
          sales history stay under its name; a new HQ called {hq.hq} opens it again.
        </p>
        <Problem message={action.problem?.message} />
        <Footer busy={action.busy} label="Close HQ" onClose={onClose} danger />
      </form>
    </Dialog>
  );
}
