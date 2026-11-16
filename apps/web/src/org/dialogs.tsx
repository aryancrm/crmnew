// The pop-ups of Team & seats: add a person (their login, their job, whom they report to, their
// area), fill an empty seat, cover a seat for a while, someone leaves, a new password, a seat or
// a team added or changed. Every one is a single step on the server, which then writes each
// person's role, boss and area from the tree.

import type { OrgHolder, OrgLogin, OrgSeat, OrgTree, OrgUnit, Role } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { api } from "../api";
import { Button, Dialog, Problem, useAction } from "../ui";

export const FIELD =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500";
const LABEL = "text-xs font-semibold text-slate-600";

/** What each module does, in the words the CEO picks by. */
export const WORK: Record<Role, { label: string; title: string; does: string }> = {
  medrep: {
    label: "MedRep",
    title: "MedRep",
    does: "Places orders for the customers of their area and follows them.",
  },
  // A head (the chart's Mentor) and a district team's Coach do the same work: they see everyone
  // under them. The title says which; "manager" stays only for the people who already have it.
  team_lead: {
    label: "Team lead",
    title: "District Sales Coach",
    does: "Sees everyone under them: a coach their team, a mentor (head) the whole business. Covers an empty MedRep seat.",
  },
  manager: {
    label: "Team lead",
    title: "Mentor",
    does: "Sees everyone under them, the whole business for a head.",
  },
  management: {
    label: "Management",
    title: "Management",
    does: "Approves the orders of every channel.",
  },
  finance: {
    label: "Finance",
    title: "Finance officer",
    does: "Checks payments, makes invoices and collects.",
  },
  dispatch: { label: "Dispatch", title: "Dispatch", does: "Packs, ships and delivers." },
  inventory: {
    label: "Inventory",
    title: "Inventory officer",
    does: "Keeps the medicines and the stock, answers medicine requests.",
  },
  online: {
    label: "Online desk",
    title: "Online desk",
    does: "Works the enquiries and chats that come in online.",
  },
  admin: { label: "Admin", title: "System admin", does: "Sets the system up and adds people." },
  hr: {
    label: "HR",
    title: "HR officer",
    does: "Adds new joiners, keeps people's records, attendance, leave and pay.",
  },
  staff: {
    label: "Office staff",
    title: "Office staff",
    does: "Digital Marketing, IT and the like: writes their day (what they did, today, tomorrow) if they want.",
  },
  regulatory: {
    label: "In-licensing & Regulatory",
    title: "Regulatory Affairs Pharmacist",
    does: "Keeps the product pipeline (In-licensing) or the FDA registrations (Regulatory Affairs), by the seat's title.",
  },
  ceo: { label: "CEO", title: "CEO", does: "Sees the whole company." },
};
/** The order the work is offered in, sales first. */
export const WORK_ORDER: Role[] = [
  "medrep",
  "team_lead",
  "online",
  "management",
  "finance",
  "dispatch",
  "inventory",
  "hr",
  "admin",
  "ceo",
];
/** Work that covers an area of customers. */
const AREA_WORK: Role[] = ["medrep", "team_lead"];

const unitById = (tree: OrgTree) => new Map(tree.units.map((unit) => [unit.id, unit]));

/** The unit and every unit above it, nearest first. */
export function lineUp(tree: OrgTree, unitId: number): OrgUnit[] {
  const units = unitById(tree);
  const line: OrgUnit[] = [];
  for (
    let at = units.get(unitId);
    at && line.length < 50;
    at = at.parentId ? units.get(at.parentId) : undefined
  )
    line.push(at);
  return line;
}

export const channelOf = (tree: OrgTree, unitId: number) =>
  lineUp(tree, unitId).find((unit) => unit.channel)?.channel ?? null;

const seatName = (seat: OrgSeat) =>
  `${seat.title}${seat.area ? ` · ${seat.area.name}` : ""} — ${seat.acting ? `${seat.acting.name} (covering)` : (seat.holder?.name ?? "vacant")}`;

/** Whom a seat in this unit reports to when nobody is picked: the unit's lead, else above. */
export function defaultBoss(tree: OrgTree, unitId: number, lead: boolean): OrgSeat | null {
  const line = lineUp(tree, unitId);
  for (const unit of lead ? line.slice(1) : line) {
    const seat = unit.seats.find((one) => one.lead);
    if (seat) return seat;
  }
  return null;
}

function Label({ text, error, children }: { text: string; error?: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control comes in as the children.
    <label className="flex min-w-0 flex-col gap-1">
      <span className={LABEL}>{text}</span>
      {children}
      {error && <span className="text-xs font-medium text-rose-700">{error}</span>}
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Footer({ busy, label, onClose }: { busy: boolean; label: string; onClose: () => void }) {
  return (
    <div className="mt-1 flex justify-end gap-2 border-t border-slate-100 pt-4">
      <Button onClick={onClose} disabled={busy}>
        Cancel
      </Button>
      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? "Saving…" : label}
      </Button>
    </div>
  );
}

function useOrgSaved() {
  const queries = useQueryClient();
  return () => queries.invalidateQueries({ queryKey: ["org"] });
}

/** The login and the password, shown once, with one button to copy both. */
export function LoginCard({
  name,
  login,
  onClose,
}: {
  name: string;
  login: OrgLogin;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const text = `${name}\nLogin ID: ${login.login ?? login.email}\nPassword: ${login.password ?? "(the one you typed)"}\nOpen: ${window.location.origin}`;
  return (
    <Dialog
      title={`${name} can sign in`}
      sub={
        login.common
          ? "Give them these. Everyone signs in with the company's common password."
          : "Give them these. They choose their own password the first time they sign in."
      }
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm">
          <dt className="text-slate-500">Login ID</dt>
          <dd className="font-semibold text-slate-900 select-all">{login.login ?? login.email}</dd>
          <dt className="text-slate-500">Password</dt>
          <dd className="font-mono font-semibold tracking-wide text-slate-900 select-all">
            {login.password ?? (
              <span className="font-sans font-normal text-slate-500">The one you typed</span>
            )}
          </dd>
        </dl>
        {login.password && !login.common && (
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <KeyRound size={14} className="shrink-0" /> This password is shown only now. Lost it?
            Give a new one from their row.
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button
            onClick={async () => {
              await navigator.clipboard?.writeText(text).catch(() => undefined);
              setCopied(true);
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy login"}
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

type JobState = {
  module: Role;
  title: string;
  titleTouched: boolean;
  reportsTo: string;
  lead: boolean;
  area: string;
  newAreaName: string;
  newAreaCities: string;
};

/** The job part of a form: the work, the title, whom it reports to, lead or not, its area. */
function JobFields({
  tree,
  unit,
  job,
  setJob,
  at,
  exceptSeat,
  ownArea,
}: {
  tree: OrgTree;
  unit: OrgUnit;
  job: JobState;
  setJob: (next: Partial<JobState>) => void;
  at: (field: string) => string | undefined;
  exceptSeat?: number;
  ownArea?: number | null;
}) {
  const hasLead = unit.seats.some((seat) => seat.lead && seat.id !== exceptSeat);
  const boss = defaultBoss(tree, unit.id, job.lead);
  const channel = channelOf(tree, unit.id);
  const above = lineUp(tree, unit.id);
  const bossChoices = above.flatMap((one) =>
    one.seats.filter((seat) => seat.id !== exceptSeat).map((seat) => ({ seat, unit: one })),
  );
  const areas = tree.areas.filter(
    (area) =>
      (!channel || area.channelId === channel.id) && (area.seatId === null || area.id === ownArea),
  );
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label text="Work they do *" error={at("module")}>
          <select
            value={job.module}
            onChange={(event) => {
              const module = event.target.value as Role;
              setJob({ module, ...(job.titleTouched ? {} : { title: WORK[module].title }) });
            }}
            className={FIELD}
          >
            {WORK_ORDER.filter((value) => tree.modules.some((one) => one.value === value)).map(
              (value) => (
                <option key={value} value={value}>
                  {WORK[value].label}
                </option>
              ),
            )}
          </select>
        </Label>
        <Label text="Job title *" error={at("title")}>
          <input
            value={job.title}
            onChange={(event) => setJob({ title: event.target.value, titleTouched: true })}
            className={FIELD}
            placeholder="MedRep"
          />
        </Label>
      </div>
      <p className="-mt-1 text-xs text-slate-500">{WORK[job.module].does}</p>
      {(!hasLead || job.lead) && (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={job.lead}
            onChange={(event) => setJob({ lead: event.target.checked, reportsTo: "" })}
            className="size-4 accent-emerald-600"
          />
          Leads {unit.name}: everyone in it reports to this seat
        </label>
      )}
      <Label text="Reports to" error={at("reportsToSeatId")}>
        <select
          value={job.reportsTo}
          onChange={(event) => setJob({ reportsTo: event.target.value })}
          className={FIELD}
        >
          <option value="">
            {boss
              ? `${job.lead ? "The lead above" : "The team's lead"}: ${seatName(boss)}`
              : "Nobody above"}
          </option>
          {bossChoices.map(({ seat, unit: one }) => (
            <option key={seat.id} value={seat.id}>
              {seatName(seat)} ({one.name})
            </option>
          ))}
        </select>
      </Label>
      {AREA_WORK.includes(job.module) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Label text="Area (their customers)" error={at("areaId")}>
            <select
              value={job.area}
              onChange={(event) => setJob({ area: event.target.value })}
              className={FIELD}
            >
              <option value="">No area</option>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
              {channel && <option value="new">+ A new area…</option>}
            </select>
          </Label>
          {job.area === "new" && (
            <Label text={`New area in ${channel?.code ?? ""} *`} error={at("newArea.name")}>
              <input
                value={job.newAreaName}
                onChange={(event) => setJob({ newAreaName: event.target.value })}
                className={FIELD}
                placeholder={`${channel?.code === "HOSP" ? "HOS" : (channel?.code ?? "HOS")} | Manila`}
              />
            </Label>
          )}
          {job.area === "new" && (
            <div className="sm:col-span-2">
              <Label text="Cities in it (comma between)">
                <input
                  value={job.newAreaCities}
                  onChange={(event) => setJob({ newAreaCities: event.target.value })}
                  className={FIELD}
                  placeholder="Manila, Malabon, Navotas"
                />
              </Label>
            </div>
          )}
        </div>
      )}
    </>
  );
}

const jobBody = (job: JobState) => ({
  module: job.module,
  title: job.title,
  lead: job.lead,
  reportsToSeatId: job.reportsTo ? Number(job.reportsTo) : null,
  areaId: job.area && job.area !== "new" ? Number(job.area) : null,
  newArea:
    job.area === "new"
      ? {
          name: job.newAreaName,
          cities: job.newAreaCities
            .split(",")
            .map((city) => city.trim())
            .filter(Boolean),
        }
      : null,
});

const freshJob = (module: Role, lead = false): JobState => ({
  module,
  title: WORK[module].title,
  titleTouched: false,
  reportsTo: "",
  lead,
  area: "",
  newAreaName: "",
  newAreaCities: "",
});

/** Add a new person to a team (a new seat), or into an empty seat; or put someone already here in it. */
export function AddPersonDialog({
  tree,
  unit,
  seat,
  module = "medrep",
  title,
  onClose,
  onLogin,
}: {
  tree: OrgTree;
  unit: OrgUnit;
  /** An empty seat to fill; else a new seat in the unit. */
  seat?: OrgSeat | null;
  module?: Role;
  /** The new seat's title, when the work's own isn't right ("URO head"). */
  title?: string;
  onClose: () => void;
  onLogin: (name: string, login: OrgLogin) => void;
}) {
  const saved = useOrgSaved();
  const action = useAction();
  const [who, setWho] = useState<"new" | "here">("new");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [startsOn, setStartsOn] = useState(tree.today);
  const [job, setJobState] = useState<JobState>(() => ({
    ...freshJob(module, module !== "medrep" && !unit.seats.some((one) => one.lead)),
    ...(title ? { title } : {}),
  }));
  const setJob = (next: Partial<JobState>) => setJobState((state) => ({ ...state, ...next }));
  const [personId, setPersonId] = useState("");
  const [keepOther, setKeepOther] = useState(false);
  const people = tree.units
    .flatMap((one) => one.seats.map((s) => ({ seat: s, unit: one })))
    .filter(({ seat: s }) => s.holder)
    .map(({ seat: s, unit: one }) => ({
      id: s.holder?.personId as number,
      name: s.holder?.name as string,
      where: `${s.title} · ${one.name}`,
    }));
  const choices = [
    ...tree.unplaced.map((person) => ({ id: person.id, name: person.name, where: "No seat yet" })),
    ...people,
  ].sort((a, b) => a.name.localeCompare(b.name));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (who === "here" && seat) {
      const done = await action.run(() =>
        api(`/api/org/seats/${seat.id}/fill`, {
          body: { personId: Number(personId), keepOther, startsOn },
        }),
      );
      if (done) {
        await saved();
        onClose();
      }
      return;
    }
    let login: OrgLogin | null = null;
    const done = await action.run(async () => {
      login = await api<OrgLogin>("/api/org/people", {
        body: {
          name,
          email: email || null,
          phone: phone || null,
          password: password || null,
          startsOn,
          ...(seat ? { seatId: seat.id } : { unitId: unit.id, ...jobBody(job) }),
        },
      });
    });
    if (done && login) {
      await saved();
      onLogin(name, login);
    }
  }

  return (
    <Dialog
      title={
        seat
          ? `Fill: ${seat.title}${seat.area ? ` · ${seat.area.name}` : ""}`
          : `Add to ${unit.name}`
      }
      sub={
        seat
          ? `In ${unit.name}, reporting to ${seat.boss ?? "nobody above"}. ${seat.customers} customer${seat.customers === 1 ? "" : "s"} and ${seat.openOrders} open order${seat.openOrders === 1 ? "" : "s"} come with the seat.`
          : "A login for them and their place in the team, in one step."
      }
      onClose={onClose}
      busy={action.busy}
      wide
    >
      <form onSubmit={submit} className="flex flex-col gap-5">
        {seat && (
          <div className="inline-flex w-fit rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm font-semibold">
            {(["new", "here"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setWho(key)}
                className={`rounded-md px-3 py-1.5 ${who === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
              >
                {key === "new" ? "A new person" : "Someone already here"}
              </button>
            ))}
          </div>
        )}
        {who === "here" && seat ? (
          <Section title="Who takes the seat">
            <Label text="Person *" error={action.at("personId")}>
              <select
                value={personId}
                onChange={(event) => setPersonId(event.target.value)}
                className={FIELD}
                required
              >
                <option value="">Pick someone…</option>
                {choices.map((person) => (
                  <option key={`${person.id}-${person.where}`} value={person.id}>
                    {person.name} — {person.where}
                  </option>
                ))}
              </select>
            </Label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={keepOther}
                onChange={(event) => setKeepOther(event.target.checked)}
                className="size-4 accent-emerald-600"
              />
              Keep their seat too (two jobs); unticked, their old seat becomes vacant
            </label>
            <Label text="From">
              <input
                type="date"
                value={startsOn}
                max={tree.today}
                onChange={(event) => setStartsOn(event.target.value)}
                className={FIELD}
              />
            </Label>
          </Section>
        ) : (
          <>
            <Section title="Who">
              <div className="grid gap-3 sm:grid-cols-2">
                <Label text="Name *" error={action.at("name")}>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className={FIELD}
                    placeholder="Full name"
                    required
                  />
                </Label>
                <Label text="Phone" error={action.at("phone")}>
                  <input
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    className={FIELD}
                    placeholder="0917 …"
                    inputMode="tel"
                  />
                </Label>
                <Label text="Their own email (optional)" error={action.at("email")}>
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className={FIELD}
                    placeholder="To reach them; not their login"
                    type="email"
                    autoComplete="off"
                  />
                </Label>
                {/* With the company's common password, nobody types one (Aryan, 17 Nov). */}
                {!tree.commonPassword && (
                  <Label text="Password" error={action.at("password")}>
                    <input
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className={FIELD}
                      placeholder="Leave empty: one is made for them"
                      autoComplete="new-password"
                    />
                  </Label>
                )}
              </div>
            </Section>
            {!seat && (
              <Section title="Their job">
                <JobFields tree={tree} unit={unit} job={job} setJob={setJob} at={action.at} />
              </Section>
            )}
            <Label text="First day">
              <input
                type="date"
                value={startsOn}
                max={tree.today}
                onChange={(event) => setStartsOn(event.target.value)}
                className={`${FIELD} sm:max-w-56`}
              />
            </Label>
          </>
        )}
        <Problem
          message={action.general([
            "name",
            "email",
            "phone",
            "password",
            "module",
            "title",
            "reportsToSeatId",
            "areaId",
            "newArea.name",
            "personId",
          ])}
        />
        <Footer
          busy={action.busy}
          label={who === "here" ? "Put them in the seat" : "Add and make their login"}
          onClose={onClose}
        />
      </form>
    </Dialog>
  );
}

/** An empty seat to fill later, or a seat's job changed. */
export function SeatDialog({
  tree,
  unit,
  seat,
  module = "medrep",
  onClose,
}: {
  tree: OrgTree;
  unit: OrgUnit;
  seat?: OrgSeat | null;
  module?: Role;
  onClose: () => void;
}) {
  const saved = useOrgSaved();
  const action = useAction();
  const [job, setJobState] = useState<JobState>(
    seat
      ? {
          module: seat.module,
          title: seat.title,
          titleTouched: true,
          reportsTo: seat.reportsToSeatId ? String(seat.reportsToSeatId) : "",
          lead: seat.lead,
          area: seat.area ? String(seat.area.id) : "",
          newAreaName: "",
          newAreaCities: "",
        }
      : freshJob(module),
  );
  const setJob = (next: Partial<JobState>) => setJobState((state) => ({ ...state, ...next }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(() =>
      seat
        ? api(`/api/org/seats/${seat.id}`, { method: "PATCH", body: jobBody(job) })
        : api("/api/org/seats", { body: { unitId: unit.id, ...jobBody(job) } }),
    );
    if (done) {
      await saved();
      onClose();
    }
  }
  return (
    <Dialog
      title={seat ? `Change the seat: ${seat.title}` : `A vacant seat in ${unit.name}`}
      sub={
        seat
          ? "Whoever sits in it follows: their work, boss and area change with the seat."
          : "A job nobody holds yet. Its area's customers wait with the team's lead."
      }
      onClose={onClose}
      busy={action.busy}
      wide
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <JobFields
          tree={tree}
          unit={unit}
          job={job}
          setJob={setJob}
          at={action.at}
          exceptSeat={seat?.id}
          ownArea={seat?.area?.id}
        />
        <Problem
          message={action.general([
            "module",
            "title",
            "reportsToSeatId",
            "areaId",
            "newArea.name",
            "lead",
          ])}
        />
        <Footer
          busy={action.busy}
          label={seat ? "Save the seat" : "Add the seat"}
          onClose={onClose}
        />
      </form>
    </Dialog>
  );
}

/** Someone covers a seat until a day: while it is empty, or while its person is away. */
export function CoverDialog({
  tree,
  seat,
  onClose,
}: {
  tree: OrgTree;
  seat: OrgSeat;
  onClose: () => void;
}) {
  const saved = useOrgSaved();
  const action = useAction();
  const [personId, setPersonId] = useState("");
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const people = tree.units
    .flatMap((one) => one.seats)
    .filter((one) => one.holder && one.holder.personId !== seat.holder?.personId)
    .map((one) => ({
      id: one.holder?.personId as number,
      name: one.holder?.name as string,
      where: one.title,
    }));
  const unique = [...new Map(people.map((person) => [person.id, person])).values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(() =>
      api(`/api/org/seats/${seat.id}/cover`, {
        body: { personId: Number(personId), until, reason: reason || null },
      }),
    );
    if (done) {
      await saved();
      onClose();
    }
  }
  return (
    <Dialog
      title={`Cover: ${seat.title}${seat.area ? ` · ${seat.area.name}` : ""}`}
      sub={`${seat.holder ? `While ${seat.holder.name} is away` : "While the seat is empty"}, the people under it report to whoever covers. It ends by itself after the last day.`}
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Label text="Who covers *" error={action.at("personId")}>
          <select
            value={personId}
            onChange={(event) => setPersonId(event.target.value)}
            className={FIELD}
            required
          >
            <option value="">Pick someone…</option>
            {unique.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name} — {person.where}
              </option>
            ))}
          </select>
        </Label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Label text="Last day *" error={action.at("until")}>
            <input
              type="date"
              value={until}
              min={tree.today}
              onChange={(event) => setUntil(event.target.value)}
              className={FIELD}
              required
            />
          </Label>
          <Label text="Why">
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={FIELD}
              placeholder="On leave / until the new lead joins"
            />
          </Label>
        </div>
        <Problem message={action.general(["personId", "until"])} />
        <Footer busy={action.busy} label="Start the cover" onClose={onClose} />
      </form>
    </Dialog>
  );
}

const LEAVE_REASONS = ["Resigned", "Contract ended", "Let go", "Retired", "Other"];

/** Someone leaves the company: the login stops at once; their seats stay, vacant, with their customers. */
export function LeaveDialog({
  holder,
  seats,
  onClose,
}: {
  holder: OrgHolder;
  seats: OrgSeat[];
  onClose: () => void;
}) {
  const saved = useOrgSaved();
  const action = useAction();
  const [reason, setReason] = useState(LEAVE_REASONS[0] as string);
  const [other, setOther] = useState("");
  const customers = seats.reduce((sum, one) => sum + one.customers, 0);
  const orders = seats.reduce((sum, one) => sum + one.openOrders, 0);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(() =>
      api(`/api/org/people/${holder.personId}/leave`, {
        body: { reason: reason === "Other" ? other || "Left the company" : reason },
      }),
    );
    if (done) {
      await saved();
      onClose();
    }
  }
  return (
    <Dialog
      title={`${holder.name} leaves`}
      sub="Their login stops now. Nothing they worked on is lost."
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <ul className="flex flex-col gap-1.5 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[13px] text-amber-950">
          {seats.map((one) => (
            <li key={one.id}>
              <b>
                {one.title}
                {one.area ? ` · ${one.area.name}` : ""}
              </b>{" "}
              becomes vacant{one.boss ? `; it waits with ${one.boss}` : ""}.
            </li>
          ))}
          {(customers > 0 || orders > 0) && (
            <li>
              {customers} customers and {orders} open orders stay with the seat for whoever fills
              it.
            </li>
          )}
        </ul>
        <div className="grid gap-3 sm:grid-cols-2">
          <Label text="Why">
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={FIELD}
            >
              {LEAVE_REASONS.map((one) => (
                <option key={one}>{one}</option>
              ))}
            </select>
          </Label>
          {reason === "Other" && (
            <Label text="In a few words">
              <input
                value={other}
                onChange={(event) => setOther(event.target.value)}
                className={FIELD}
              />
            </Label>
          )}
        </div>
        <Problem message={action.general([])} />
        <div className="mt-1 flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={action.busy}>
            {action.busy ? "Saving…" : `${holder.name} has left`}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const KINDS: { value: "business" | "line" | "team" | "department"; label: string }[] = [
  { value: "team", label: "Team" },
  { value: "line", label: "Business line" },
  { value: "business", label: "Business / division" },
  { value: "department", label: "Department" },
];

/** A team (or line, business, department) under a unit, or one renamed. */
export function UnitDialog({
  tree,
  parent,
  unit,
  team = false,
  onClose,
}: {
  tree: OrgTree;
  parent?: OrgUnit | null;
  unit?: OrgUnit | null;
  /** Only a team, in its parent's channel: the Admin panel's channel page asks nothing else. */
  team?: boolean;
  onClose: () => void;
}) {
  const saved = useOrgSaved();
  const action = useAction();
  const [name, setName] = useState(unit?.name ?? "");
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>(
    parent?.kind === "company" && !team ? "business" : "team",
  );
  const [channel, setChannel] = useState(unit?.channel ? String(unit.channel.id) : "");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const channelId = channel ? Number(channel) : null;
    const done = await action.run(() =>
      unit
        ? api(`/api/org/units/${unit.id}`, { method: "PATCH", body: { name, channelId } })
        : api("/api/org/units", { body: { name, kind, parentId: parent?.id, channelId } }),
    );
    if (done) {
      await saved();
      onClose();
    }
  }
  return (
    <Dialog
      title={
        unit
          ? `Change ${unit.name}`
          : team
            ? `A new team in ${parent?.name ?? ""}`
            : `A new box under ${parent?.name ?? ""}`
      }
      sub={
        unit || team
          ? undefined
          : "A team, a business line, a business or a department. Add its seats after."
      }
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Label text="Name *" error={action.at("name")}>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={FIELD}
              placeholder="NCR 2"
              required
            />
          </Label>
          {!unit && !team && (
            <Label text="What it is">
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as typeof kind)}
                className={FIELD}
              >
                {KINDS.map((one) => (
                  <option key={one.value} value={one.value}>
                    {one.label}
                  </option>
                ))}
              </select>
            </Label>
          )}
          {!team && (
            <Label text="Sales channel" error={action.at("channelId")}>
              <select
                value={channel}
                onChange={(event) => setChannel(event.target.value)}
                className={FIELD}
              >
                <option value="">{parent || unit ? "Same as above (or none)" : "None"}</option>
                {tree.channels
                  .filter((one) => one.active || one.id === unit?.channel?.id)
                  .map((one) => (
                    <option key={one.id} value={one.id}>
                      {one.code} · {one.name}
                    </option>
                  ))}
              </select>
            </Label>
          )}
        </div>
        <Problem message={action.general(["name", "channelId"])} />
        <Footer busy={action.busy} label={unit ? "Save" : "Add"} onClose={onClose} />
      </form>
    </Dialog>
  );
}
