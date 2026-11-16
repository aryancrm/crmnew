// What the Online desk's screens share: the roads and sources in words, the road's badge, and
// the New lead dialog.

import { formatPhone } from "@2mg/api/phone";
import type {
  CustomerMatch,
  GlAgency,
  LeadDesk,
  LeadInput,
  LeadRoad,
  LeadSource,
} from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { onlineDesk, useMe } from "../auth";
import { smaller } from "../photo";
import { Button, Dialog, Problem, useAction } from "../ui";

export const SOURCES: { key: LeadSource; label: string }[] = [
  { key: "messenger", label: "Messenger" },
  { key: "website", label: "Website" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "website_2mg", label: "2MG website" },
  { key: "website_capsandpills", label: "Caps & Pills website" },
  { key: "phone", label: "Call" },
  { key: "walk_in", label: "Walk-in" },
  { key: "referral", label: "Referral" },
  { key: "email", label: "Email" },
  { key: "other", label: "Other" },
];

export const ROADS: { key: LeadRoad; label: string; line: string }[] = [
  { key: "regular", label: "Regular", line: "Regular — no discount" },
  { key: "senior", label: "Senior", line: "Senior citizen — 20% off, no VAT" },
  { key: "pwd", label: "PWD", line: "PWD — 20% off, no VAT" },
  { key: "gl", label: "GL", line: "Guarantee letter — the agency pays" },
];

export const AGENCIES: { key: GlAgency; label: string; short: string }[] = [
  { key: "dswd", label: "DSWD (AICS)", short: "DSWD" },
  { key: "pcso", label: "PCSO (IMAP)", short: "PCSO" },
  { key: "ovp", label: "Office of the Vice President", short: "OVP" },
  { key: "op", label: "Office of the President (PMS)", short: "OP" },
];

/** The road's pill on a card, as the old desk drew it. */
export const ROAD_BADGE: Record<
  LeadRoad,
  { bg: string; text: string; border: string; label: string }
> = {
  regular: {
    bg: "bg-slate-50",
    text: "text-slate-700",
    border: "border-slate-200",
    label: "Regular",
  },
  senior: {
    bg: "bg-amber-50",
    text: "text-amber-800",
    border: "border-amber-200",
    label: "Senior / PWD",
  },
  pwd: {
    bg: "bg-amber-50",
    text: "text-amber-800",
    border: "border-amber-200",
    label: "Senior / PWD",
  },
  gl: { bg: "bg-purple-50", text: "text-purple-800", border: "border-purple-200", label: "GL" },
};
/** The current step's colour on the card's strip, by road. */
export const ROAD_TRACK: Record<LeadRoad, { active: string; ring: string }> = {
  regular: { active: "bg-blue-600", ring: "ring-blue-200" },
  senior: { active: "bg-amber-600", ring: "ring-amber-200" },
  pwd: { active: "bg-amber-600", ring: "ring-amber-200" },
  gl: { active: "bg-purple-600", ring: "ring-purple-200" },
};

/** Puts one paper on a case: a photo made smaller first. */
export async function uploadLeadFile(leadId: number, kind: string, file: File): Promise<number> {
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", await smaller(file));
  return (await api<{ id: number }>(`/api/leads/${leadId}/files`, { body: form })).id;
}

/** Who is writing, as the old Case details asks it. */
export const RELATIONS: { key: string; label: string }[] = [
  { key: "self", label: "The patient themself" },
  { key: "spouse", label: "Spouse" },
  { key: "parent", label: "Parent" },
  { key: "child", label: "Son / daughter" },
  { key: "sibling", label: "Sibling" },
  { key: "caregiver", label: "Caregiver" },
  { key: "other", label: "Other representative" },
];

/** The four ways to pay as the old Case details draws them: a big choice each. */
const ROAD_CHOICES: { key: LeadRoad; title: string; note: string }[] = [
  { key: "regular", title: "Regular", note: "" },
  { key: "senior", title: "Senior citizen", note: "RA 9994" },
  { key: "pwd", title: "PWD", note: "RA 10754" },
  { key: "gl", title: "Guarantee letter", note: "agency pays" },
];

/** A text box as the old Case details draws it. */
const BOX =
  "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50 disabled:text-slate-400";
const LABEL = "block text-xs font-semibold text-slate-600";

/** A big choice (how they pay, which agency), the old Case details' tile. */
export const choiceClass = (on: boolean, locked: boolean) =>
  `flex min-h-16 flex-col items-start justify-center rounded-xl border px-3 py-2 text-left transition ${
    on
      ? locked
        ? "border-slate-400 bg-slate-100 text-slate-800"
        : "border-emerald-700 bg-emerald-50 text-emerald-950 ring-2 ring-emerald-600/30"
      : locked
        ? "border-slate-200 bg-slate-50 text-slate-400"
        : "border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/40"
  } disabled:cursor-not-allowed`;

function Err({ message }: { message?: string }) {
  if (!message) return null;
  return <span className="mt-1 block text-xs font-medium text-rose-700">{message}</span>;
}

/** The details form a new enquiry and Case details share, laid out as the old CRM's Case
 *  details: who is writing and who they are, phone and email, the address, then how they pay
 *  as four big choices (and the agency as four more on the guarantee letter). */
export function LeadForm({
  start,
  agents,
  busy,
  at,
  onSubmit,
  submitLabel,
  onClose,
  closeLabel = "Later",
  problem,
  lockRoad,
  focus,
  pap = false,
}: {
  start: LeadInput;
  agents: { id: number; name: string }[];
  busy: boolean;
  at: (field: string) => string | undefined;
  onSubmit: (input: LeadInput) => void;
  submitLabel: string;
  onClose: () => void;
  closeLabel?: string;
  problem: string | null;
  lockRoad?: string | null;
  /** The field to put the cursor in ("Add email" opens the form at the email). */
  focus?: "email";
  /** A PAP MedRep's case: always a guarantee letter, always theirs (no owner, no road choice). */
  pap?: boolean;
}) {
  const [value, setValue] = useState<LeadInput>(start);
  const startRelation = !start.relation || start.relation === "self" ? "self" : start.relation;
  const [relation, setRelation] = useState(startRelation);
  const self = relation === "self";
  // The email is asked every time (each step of the order is emailed to them); "No email" says
  // they truly have none.
  const [noEmail, setNoEmail] = useState(false);
  const [emailMissing, setEmailMissing] = useState(false);
  const set = (changes: Partial<LeadInput>) => setValue((current) => ({ ...current, ...changes }));
  const digits = (value.phone ?? "").replace(/\D/g, "");
  const [asked, setAsked] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setAsked(digits.length >= 7 ? digits : ""), 400);
    return () => clearTimeout(timer);
  }, [digits]);
  const matches = useQuery({
    queryKey: ["customers", "check", asked],
    queryFn: () =>
      api<{ matches: CustomerMatch[] }>(`/api/customers/check?phone=${asked}&kind=patient`),
    enabled: asked.length >= 7,
  });
  // A relation typed before the list existed ("daughter") stays a choice of its own.
  const relations = RELATIONS.some((item) => item.key === startRelation)
    ? RELATIONS
    : [...RELATIONS, { key: startRelation, label: startRelation }];
  const locked = Boolean(lockRoad);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!(value.email ?? "").trim() && !noEmail) {
      setEmailMissing(true);
      return;
    }
    onSubmit({
      ...value,
      relation: self ? null : relation,
      patientName: self ? null : value.patientName,
      agency: value.road === "gl" ? value.agency : null,
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">Who</legend>
        <label className={LABEL}>
          Who is writing or calling <span className="text-rose-600">*</span>
          <input
            name="name"
            autoComplete="off"
            placeholder="Their name"
            className={BOX}
            value={value.name}
            onChange={(event) => set({ name: event.target.value })}
          />
          <Err message={at("name")} />
        </label>
        <label className={LABEL}>
          They are
          <select
            name="relation"
            className={BOX}
            value={relation}
            onChange={(event) => setRelation(event.target.value)}
          >
            {relations.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
          <Err message={at("relation")} />
        </label>
        {!self && (
          <label className={`${LABEL} sm:col-span-2`}>
            The patient's name <span className="text-rose-600">*</span>
            <input
              name="patientName"
              placeholder="The patient's full name"
              className={BOX}
              value={value.patientName ?? ""}
              onChange={(event) => set({ patientName: event.target.value })}
            />
            <Err message={at("patientName")} />
          </label>
        )}
        <label className={LABEL}>
          Phone
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="0917 123 4567"
            className={`${BOX} font-mono`}
            value={value.phone ?? ""}
            onChange={(event) => set({ phone: event.target.value })}
            onBlur={(event) => set({ phone: formatPhone(event.target.value) })}
          />
          <Err message={at("phone")} />
        </label>
        <div>
          <label className={LABEL}>
            Email
            <input
              name="email"
              type="text"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              // biome-ignore lint/a11y/noAutofocus: "Add email" opens the form to type it.
              autoFocus={focus === "email"}
              placeholder="name@example.com"
              disabled={noEmail}
              className={BOX}
              value={value.email ?? ""}
              onChange={(event) => {
                setEmailMissing(false);
                set({ email: event.target.value });
              }}
            />
          </label>
          <label className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
            <input
              type="checkbox"
              checked={noEmail}
              onChange={(event) => {
                setNoEmail(event.target.checked);
                setEmailMissing(false);
                if (event.target.checked) set({ email: null });
              }}
            />
            No email
          </label>
          <Err
            message={
              emailMissing
                ? "Type their email, or tick “No email”: every step of the order is emailed to them."
                : at("email")
            }
          />
        </div>
        {(matches.data?.matches.length ?? 0) > 0 && (
          <div className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900 sm:col-span-2">
            Already a customer on this number:{" "}
            <b>{matches.data?.matches.map((match) => match.name).join(", ")}</b>. The order will go
            to them.
          </div>
        )}
        <label className={`${LABEL} sm:col-span-2`}>
          Delivery address
          <input
            name="address"
            autoComplete="off"
            placeholder="House no., street, barangay"
            className={BOX}
            value={value.address ?? ""}
            onChange={(event) => set({ address: event.target.value })}
          />
          <Err message={at("address")} />
        </label>
        <label className={`${LABEL} sm:col-span-2`}>
          City / province
          <input
            name="city"
            placeholder="e.g. Las Piñas City"
            className={BOX}
            value={value.city ?? ""}
            onChange={(event) => set({ city: event.target.value })}
          />
          <Err message={at("city")} />
        </label>
        <label className={LABEL}>
          Came in through
          <select
            name="source"
            className={BOX}
            value={value.source}
            onChange={(event) => set({ source: event.target.value as LeadSource })}
          >
            {SOURCES.map((source) => (
              <option key={source.key} value={source.key}>
                {source.label}
              </option>
            ))}
          </select>
          <Err message={at("source")} />
        </label>
        {!pap && (
          <label className={LABEL}>
            Owner
            <select
              name="assignedTo"
              className={BOX}
              value={value.assignedTo ?? ""}
              onChange={(event) =>
                set({ assignedTo: event.target.value ? Number(event.target.value) : null })
              }
            >
              <option value="">Unassigned</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <Err message={at("assignedTo")} />
          </label>
        )}
        <label className={`${LABEL} sm:col-span-2`}>
          What they are asking for
          <textarea
            name="request"
            placeholder="The medicine, the strength, how many…"
            className={`${BOX} h-auto min-h-20 py-2`}
            value={value.request ?? ""}
            onChange={(event) => set({ request: event.target.value })}
          />
          <Err message={at("request")} />
        </label>
      </fieldset>

      <fieldset disabled={busy} className="space-y-2">
        <legend className="text-sm font-semibold text-slate-900">
          {pap ? "Guarantee letter from" : "How will they pay?"}
        </legend>
        <div className={`grid grid-cols-2 gap-2 sm:grid-cols-4 ${pap ? "hidden" : ""}`}>
          {ROAD_CHOICES.map((road) => (
            <button
              key={road.key}
              type="button"
              aria-pressed={value.road === road.key}
              disabled={locked}
              title={lockRoad ?? undefined}
              onClick={() => set({ road: road.key })}
              className={choiceClass(value.road === road.key, locked)}
            >
              <span className="text-sm font-bold">{road.title}</span>
              {road.note && <span className="text-[11px] opacity-75">{road.note}</span>}
            </button>
          ))}
        </div>
        {value.road === "gl" && (
          <fieldset className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4">
            <legend className={`mb-1 text-xs font-semibold text-slate-600 ${pap ? "sr-only" : ""}`}>
              Which agency gives the letter?
            </legend>
            {AGENCIES.map((agency) => (
              <button
                key={agency.key}
                type="button"
                aria-pressed={value.agency === agency.key}
                disabled={locked}
                onClick={() => set({ agency: agency.key })}
                className={choiceClass(value.agency === agency.key, locked)}
              >
                <span className="text-sm font-bold">{agency.short}</span>
                <span className="text-[11px] opacity-75">{agency.label}</span>
              </button>
            ))}
          </fieldset>
        )}
        <Err message={at("road") ?? at("agency")} />
        {lockRoad ? (
          <p className="flex items-center gap-2 text-xs text-slate-600">
            <Lock aria-hidden="true" className="size-3.5 shrink-0 text-slate-500" />
            {ROADS.find((road) => road.key === value.road)?.line}. {lockRoad}
          </p>
        ) : (
          value.road === "regular" && (
            <p className="text-[11px] text-slate-500">
              The customer's points can be used on a regular sale's quotation.
            </p>
          )
        )}
      </fieldset>

      <Problem message={problem} />
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
        <Button onClick={onClose} disabled={busy} className="h-10 text-xs">
          {closeLabel}
        </Button>
        <Button type="submit" variant="primary" disabled={busy} className="h-10 text-xs">
          {busy ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

const FIELDS = [
  "source",
  "name",
  "relation",
  "patientName",
  "phone",
  "email",
  "city",
  "address",
  "road",
  "agency",
  "request",
  "assignedTo",
];

/** A new enquiry: typed in by the agent (a call, a walk-in, a chat until Messenger connects). */
export function NewLeadDialog({
  agents,
  onClose,
  pap = false,
}: {
  agents: LeadDesk["agents"];
  onClose: () => void;
  /** A PAP MedRep's new case: a guarantee letter's road, theirs. */
  pap?: boolean;
}) {
  const me = useMe().data;
  const navigate = useNavigate();
  const queries = useQueryClient();
  const action = useAction();
  async function save(input: LeadInput) {
    let id = 0;
    const done = await action.run(async () => {
      id = (await api<{ id: number }>("/api/leads", { body: input })).id;
    });
    if (!done) return;
    await queries.invalidateQueries({ queryKey: ["leads"] });
    onClose();
    navigate(`/leads/${id}`);
  }
  return (
    <Dialog
      title={pap ? "New PAP case" : "New enquiry"}
      sub={
        pap
          ? "The patient, how to reach them and the agency giving the letter. Save, and the case opens."
          : "Who is asking, how to reach them and how they pay. Save, and the case opens."
      }
      onClose={onClose}
      busy={action.busy}
    >
      <LeadForm
        start={{
          source: pap ? "referral" : "messenger",
          name: "",
          road: pap ? "gl" : "regular",
          assignedTo: me && onlineDesk(me) ? me.id : null,
        }}
        pap={pap}
        agents={agents}
        busy={action.busy}
        at={action.at}
        onSubmit={save}
        submitLabel={pap ? "Open the case" : "Add enquiry"}
        closeLabel="Cancel"
        onClose={onClose}
        problem={action.general(FIELDS)}
      />
    </Dialog>
  );
}
