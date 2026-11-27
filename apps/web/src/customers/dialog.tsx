// Adding or changing a customer. While a name or number is typed it asks the API whether this
// is someone already on file, so the same hospital or patient isn't added twice.

import { formatPhone } from "@2mg/api/phone";
import type {
  CustomerCan,
  CustomerDetail,
  CustomerKind,
  CustomerList,
  CustomerMatch,
  CustomerPaperKind,
  PaymentTerms,
} from "@2mg/api/types";
import { FileCheck2, Paperclip, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { PAPER_ACCEPT } from "../photo";
import { Button, Dialog, Field, INPUT, Problem, useAction } from "../ui";

/** The kinds that buy with a licence to operate: the hub asked them for it and three papers. */
const LICENSED: CustomerKind[] = ["hospital", "distributor", "drugstore"];
const CUSTOMER_PAPERS: { kind: CustomerPaperKind; label: string }[] = [
  { kind: "bir_2303", label: "BIR 2303" },
  { kind: "lto_permit", label: "LTO permit" },
  { kind: "business_permit", label: "Business permit" },
];
/** What a licence to operate is for, as Zoho's customers had it (any other can be typed). */
const LTO_TYPES = [
  "Hospital",
  "Drugstore",
  "Drug Wholesaler",
  "Drug Distributor-Wholesaler",
  "Drug Importer/Wholesaler",
  "Drug Importer/Exporter/Wholesaler",
  "Drug Importer",
  "Medical Device Distributor-Wholesaler",
];

/** The value, a moment after it stops changing. */
function useSettled<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export function CustomerDialog(props: {
  can: CustomerCan;
  kinds: CustomerList["kinds"];
  /** The kind a new customer starts as (the list it is added from). */
  kind?: CustomerKind;
  /** Changing this customer instead of adding one. */
  detail?: CustomerDetail;
  onClose: () => void;
  onSaved?: (id: number) => void;
  /** Picking a customer already on file (the order form): "Use this one" instead of Open. */
  onPick?: (id: number) => void;
}) {
  const queries = useQueryClient();
  const action = useAction();
  const now = props.detail?.customer;
  const [kind, setKind] = useState<CustomerKind>(now?.kind ?? props.kind ?? "hospital");
  const [name, setName] = useState(now?.name ?? "");
  const [phone, setPhone] = useState(now?.phone ?? "");
  const [email, setEmail] = useState(now?.email ?? "");
  // Asked every time, as on a new enquiry: each step of their orders is emailed to them. "No
  // email" says they truly have none (a doctor who only texts, a small clinic).
  const [noEmail, setNoEmail] = useState(false);
  const [emailMissing, setEmailMissing] = useState(false);
  const [city, setCity] = useState(now?.city ?? "");
  const [address, setAddress] = useState(now?.address ?? "");
  const [specialty, setSpecialty] = useState(now?.specialty ?? "");
  const [licenceNo, setLicenceNo] = useState(now?.licenceNo ?? "");
  const [licenceExpires, setLicenceExpires] = useState(now?.licenceExpires ?? "");
  const [tin, setTin] = useState(now?.tin ?? "");
  const [licenceOwner, setLicenceOwner] = useState(now?.licenceOwner ?? "");
  const [ltoType, setLtoType] = useState(now?.ltoType ?? "");
  const [licenceIssued, setLicenceIssued] = useState(now?.licenceIssued ?? "");
  const [files, setFiles] = useState<Partial<Record<CustomerPaperKind, File>>>({});
  // A distributor or drugstore may follow up its papers (the hub's "submit anyway").
  const [followUp, setFollowUp] = useState(false);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [note, setNote] = useState(now?.note ?? "");
  const [areaId, setAreaId] = useState(String(now?.areaId ?? ""));
  const [terms, setTerms] = useState<PaymentTerms>(now?.paymentTerms ?? "advance");
  const [days, setDays] = useState(String(now?.paymentDays ?? ""));
  const [credit, setCredit] = useState(now?.creditLimit ? String(now.creditLimit / 100) : "");

  const business = kind !== "patient";
  const licensed = LICENSED.includes(kind);
  const onFile = new Set((props.detail?.papers ?? []).map((paper) => paper.kind));
  // The hub's list, missing from what is typed and attached.
  const lacking = licensed
    ? [
        ...(tin.trim() ? [] : ["TIN"]),
        ...(licenceOwner.trim() ? [] : ["licence owner"]),
        ...(licenceNo.trim() ? [] : ["LTO number"]),
        ...(ltoType.trim() ? [] : ["LTO type"]),
        ...(licenceIssued ? [] : ["issue date"]),
        ...(licenceExpires ? [] : ["expiry date"]),
        ...CUSTOMER_PAPERS.filter((paper) => !files[paper.kind] && !onFile.has(paper.kind)).map(
          (paper) => paper.label,
        ),
      ]
    : [];
  // From the field a hospital is added whole (the hub's "Hospital Creation Restricted"); a
  // distributor or drugstore with something missing goes on once its follow-up is promised.
  const blocked =
    !now &&
    !props.can.manage &&
    lacking.length > 0 &&
    (kind === "hospital" || !followUp);
  const typed = useSettled({ name: name.trim(), phone: phone.trim(), kind, licence: kind === "doctor" ? licenceNo.trim() : "" });
  const check = useQuery({
    queryKey: ["customers", "check", typed],
    queryFn: async () =>
      (
        await api<{ matches: CustomerMatch[] }>(
          `/api/customers/check?kind=${typed.kind}&name=${encodeURIComponent(typed.name)}&phone=${encodeURIComponent(typed.phone)}&licence=${encodeURIComponent(typed.licence)}`,
        )
      ).matches,
    enabled:
      !now &&
      (typed.name.length >= 3 || typed.phone.replace(/\D/g, "").length >= 7 || typed.licence.replace(/\D/g, "").length >= 4),
  });
  const matches = now ? [] : (check.data ?? []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() && !noEmail) {
      setEmailMissing(true);
      return;
    }
    let saved = now?.id;
    const done = await action.run(async () => {
      const body = {
        kind,
        name,
        phone,
        email,
        city,
        address,
        specialty: kind === "doctor" ? specialty : null,
        worksAt: kind === "doctor" ? (now?.worksAtId ?? null) : null,
        licenceNo,
        licenceExpires: licenceExpires || null,
        tin,
        licenceOwner: licensed ? licenceOwner : null,
        ltoType: licensed ? ltoType : null,
        licenceIssued: licensed ? licenceIssued || null : null,
        note,
        ...(props.can.manage
          ? {
              areaId: areaId ? Number(areaId) : null,
              paymentTerms: terms,
              paymentDays: terms === "days" ? Number(days) || null : null,
              creditLimit: credit.trim()
                ? Math.round(Number(credit.replace(/,/g, "")) * 100)
                : null,
            }
          : {}),
      };
      if (now) await api(`/api/customers/${now.id}`, { body });
      else saved = (await api<{ id: number }>("/api/customers", { body })).id;
    });
    if (!done) return;
    // Its papers, each on its own: one that fails can be added again from the customer's page.
    const failed: string[] = [];
    for (const paper of CUSTOMER_PAPERS) {
      const file = files[paper.kind];
      if (!file || !saved) continue;
      const form = new FormData();
      form.set("kind", paper.kind);
      form.set("file", file);
      try {
        await api(`/api/customers/${saved}/papers`, { body: form });
      } catch {
        failed.push(paper.label);
      }
    }
    await queries.invalidateQueries({ queryKey: ["customers"] });
    if (failed.length) {
      setFileProblem(
        `Saved, but ${failed.join(" and ")} didn't upload: add it again on the customer's page.`,
      );
      return;
    }
    props.onClose();
    if (saved) props.onSaved?.(saved);
  }

  const label = props.kinds.find((entry) => entry.key === kind)?.label ?? "customer";

  return (
    <Dialog
      title={now ? `Edit ${now.name}` : "Add a customer"}
      sub="A customer is known by their phone number: one number, one customer. Each gets a CUS number."
      onClose={props.onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {!now && (
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold text-slate-600">Kind</legend>
            <div className="flex flex-wrap gap-1.5">
              {props.kinds.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  aria-pressed={kind === entry.key}
                  onClick={() => setKind(entry.key)}
                  className={`h-8 rounded-lg px-3 text-xs font-semibold transition-colors ${
                    kind === entry.key
                      ? "bg-emerald-700 text-white shadow-2xs"
                      : "text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {/* The phone number first: it is how a customer is known, and an existing one shows
            as soon as it is typed. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone" error={action.at("phone")}>
            {(field) => (
              <input
                {...field}
                className={`${INPUT} font-mono`}
                type="tel"
                inputMode="tel"
                placeholder="0917 123 4567"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                onBlur={(event) => setPhone(formatPhone(event.target.value) ?? "")}
              />
            )}
          </Field>
          <Field label={`${label}'s name`} error={action.at("name")}>
            {(field) => (
              <input
                {...field}
                className={INPUT}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
        </div>

        {/* One doctor, one entry (Aryan, 27 Nov): a doctor is known by their PRC licence number,
            which is on every prescription; one already on file shows as soon as it is typed. */}
        {kind === "doctor" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="PRC licence no." error={action.at("licenceNo")}>
              {(field) => (
                <input
                  {...field}
                  className={`${INPUT} font-mono`}
                  inputMode="numeric"
                  placeholder="e.g. 0123456 (on their prescription)"
                  value={licenceNo}
                  onChange={(event) => setLicenceNo(event.target.value)}
                />
              )}
            </Field>
            <p className="self-end pb-2.5 text-[11.5px] leading-snug text-slate-500">
              One doctor, one entry: no two doctors have the same PRC number.
            </p>
          </div>
        )}

        {matches.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-950">
            <div className="font-semibold">Already on file? Check before adding again.</div>
            {matches.map((match) => (
              <div key={match.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{match.name}</span>
                <span>
                  {props.kinds.find((entry) => entry.key === match.kind)?.label}
                  {match.city ? ` · ${match.city}` : ""}
                  {match.phone ? ` · ${match.phone}` : ""}
                  {match.medrep ? ` · looked after by ${match.medrep}` : ""}
                  {match.why === "phone" ? " · same number" : match.why === "licence" ? " · same PRC number" : ""}
                </span>
                {match.mine &&
                  (props.onPick ? (
                    <button
                      type="button"
                      onClick={() => {
                        props.onPick?.(match.id);
                        props.onClose();
                      }}
                      className="font-semibold text-brand-dark underline-offset-2 hover:underline"
                    >
                      Use this one
                    </button>
                  ) : (
                    <Link
                      to={`/customers/${match.id}`}
                      onClick={props.onClose}
                      className="font-semibold text-brand-dark"
                    >
                      Open
                    </Link>
                  ))}
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="City" error={action.at("city")}>
            {(field) => (
              <input
                {...field}
                className={INPUT}
                value={city}
                onChange={(event) => setCity(event.target.value)}
              />
            )}
          </Field>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Field
              label="Email"
              error={
                emailMissing
                  ? "Type their email, or tick “No email”: each step of their orders is emailed to them."
                  : action.at("email")
              }
            >
              {(field) => (
                <input
                  {...field}
                  className={INPUT}
                  type="email"
                  disabled={noEmail}
                  value={email}
                  onChange={(event) => {
                    setEmailMissing(false);
                    setEmail(event.target.value);
                  }}
                />
              )}
            </Field>
            <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
              <input
                type="checkbox"
                checked={noEmail}
                onChange={(event) => {
                  setNoEmail(event.target.checked);
                  setEmailMissing(false);
                  if (event.target.checked) setEmail("");
                }}
              />
              No email
            </label>
          </div>
        </div>
        {licensed && (
          // The hub's new-customer form for a business: its licence to operate and three papers.
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <Paperclip className="size-4 text-brand" aria-hidden="true" /> Licence and papers
              <span className="font-normal text-slate-500">
                {kind === "hospital"
                  ? "· all needed for a hospital"
                  : "· Management checks what is missing"}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="TIN" error={action.at("tin")}>
                {(field) => (
                  <input {...field} className={INPUT} value={tin} onChange={(event) => setTin(event.target.value)} />
                )}
              </Field>
              <Field label="Licence owner">
                {(field) => (
                  <input
                    {...field}
                    className={INPUT}
                    value={licenceOwner}
                    onChange={(event) => setLicenceOwner(event.target.value)}
                  />
                )}
              </Field>
              <Field label="LTO number" error={action.at("licenceNo")}>
                {(field) => (
                  <input
                    {...field}
                    className={INPUT}
                    value={licenceNo}
                    onChange={(event) => setLicenceNo(event.target.value)}
                  />
                )}
              </Field>
              <Field label="LTO type">
                {(field) => (
                  <>
                    <input
                      {...field}
                      list="lto-types"
                      className={INPUT}
                      value={ltoType}
                      onChange={(event) => setLtoType(event.target.value)}
                    />
                    <datalist id="lto-types">
                      {LTO_TYPES.map((type) => (
                        <option key={type} value={type} />
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
              <Field label="Issued on">
                {(field) => (
                  <input
                    {...field}
                    type="date"
                    className={INPUT}
                    value={licenceIssued}
                    onChange={(event) => setLicenceIssued(event.target.value)}
                  />
                )}
              </Field>
              <Field label="Valid until" error={action.at("licenceExpires")}>
                {(field) => (
                  <input
                    {...field}
                    type="date"
                    className={INPUT}
                    value={licenceExpires}
                    onChange={(event) => setLicenceExpires(event.target.value)}
                  />
                )}
              </Field>
            </div>
            <ul className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200">
              {CUSTOMER_PAPERS.map((paper) => {
                const file = files[paper.kind];
                return (
                  <li key={paper.kind} className="flex min-h-11 items-center justify-between gap-3 px-3 py-1.5">
                    <span className="text-[13px] text-slate-900">
                      {paper.label}
                      {onFile.has(paper.kind) && !file && (
                        <span className="ml-2 text-[11px] text-good">On file</span>
                      )}
                    </span>
                    {file ? (
                      <span className="flex min-w-0 items-center gap-2 text-xs">
                        <FileCheck2 className="size-4 shrink-0 text-good" aria-hidden="true" />
                        <span className="max-w-40 truncate font-semibold text-good" title={file.name}>
                          {file.name}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove the ${paper.label}`}
                          onClick={() => setFiles((all) => ({ ...all, [paper.kind]: undefined }))}
                          className="grid size-7 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <X className="size-3.5" />
                        </button>
                      </span>
                    ) : (
                      <label className="inline-flex h-9 cursor-pointer items-center rounded-lg px-2 text-xs font-semibold text-brand hover:bg-brand-tint">
                        {onFile.has(paper.kind) ? "Add newer" : "Attach"}
                        <input
                          type="file"
                          accept={PAPER_ACCEPT}
                          className="sr-only"
                          onChange={(event) => {
                            const chosen = event.target.files?.[0];
                            if (chosen) setFiles((all) => ({ ...all, [paper.kind]: chosen }));
                            event.target.value = "";
                          }}
                        />
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
            {lacking.length > 0 && !now && (
              <div
                className={`rounded-lg px-3 py-2 text-xs ${kind === "hospital" && !props.can.manage ? "bg-bad-tint text-bad" : "bg-amber-50 text-amber-900"}`}
              >
                {kind === "hospital" && !props.can.manage ? (
                  <>
                    <b>A hospital can't be added yet.</b> Missing: {lacking.join(", ")}.
                  </>
                ) : (
                  <>
                    Missing: {lacking.join(", ")}.{" "}
                    {props.can.manage ? "Add them when you have them." : null}
                  </>
                )}
                {kind !== "hospital" && !props.can.manage && (
                  <label className="mt-1.5 flex items-center gap-2 font-semibold">
                    <input
                      type="checkbox"
                      checked={followUp}
                      onChange={(event) => setFollowUp(event.target.checked)}
                    />
                    I'll follow up on the missing ones: add it anyway (Management reviews it)
                  </label>
                )}
              </div>
            )}
          </div>
        )}

        {/* What isn't needed to place an order, folded: open it to add more. */}
        <details
          open={Boolean(address || specialty || (!licensed && ((kind !== "doctor" && licenceNo) || licenceExpires || tin)) || note)}
          className="group rounded-xl border border-slate-200 bg-white"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900">
            More details
            <span className="text-[11px] font-normal text-slate-400">
              Address
              {business && !licensed ? (kind === "doctor" ? ", specialty, licence expiry, TIN" : ", LTO, TIN") : ""}, note ·
              optional
            </span>
          </summary>
          <div className="flex flex-col gap-3 border-t border-slate-100 p-3">
            <Field label="Address">
              {(field) => (
                <input
                  {...field}
                  className={INPUT}
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                />
              )}
            </Field>
            {kind === "doctor" && (
              <Field label="Specialty">
                {(field) => (
                  <input
                    {...field}
                    className={INPUT}
                    placeholder="Oncology"
                    value={specialty}
                    onChange={(event) => setSpecialty(event.target.value)}
                  />
                )}
              </Field>
            )}
            {business && !licensed && (
              <div className="grid gap-3 sm:grid-cols-3">
                {kind !== "doctor" && (
                  <Field label="LTO number">
                    {(field) => (
                      <input
                        {...field}
                        className={INPUT}
                        value={licenceNo}
                        onChange={(event) => setLicenceNo(event.target.value)}
                      />
                    )}
                  </Field>
                )}
                <Field label={kind === "doctor" ? "PRC licence valid until" : "Valid until"} error={action.at("licenceExpires")}>
                  {(field) => (
                    <input
                      {...field}
                      className={INPUT}
                      type="date"
                      value={licenceExpires}
                      onChange={(event) => setLicenceExpires(event.target.value)}
                    />
                  )}
                </Field>
                <Field label="TIN">
                  {(field) => (
                    <input
                      {...field}
                      className={INPUT}
                      value={tin}
                      onChange={(event) => setTin(event.target.value)}
                    />
                  )}
                </Field>
              </div>
            )}

            <Field label="Note">
              {(field) => (
                <input
                  {...field}
                  className={INPUT}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              )}
            </Field>
          </div>
        </details>

        {props.can.manage && (
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="text-xs font-semibold text-slate-600">Set by Management</div>
            <div className="grid gap-3 sm:grid-cols-3">
              {props.detail && (
                <Field label="Area">
                  {(field) => (
                    <select
                      {...field}
                      className={INPUT}
                      value={areaId}
                      onChange={(event) => setAreaId(event.target.value)}
                    >
                      <option value="">No area</option>
                      {props.detail?.areas.map((area) => (
                        <option key={area.id} value={area.id}>
                          {area.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              )}
              <Field label="Pays">
                {(field) => (
                  <select
                    {...field}
                    className={INPUT}
                    value={terms}
                    onChange={(event) => setTerms(event.target.value as PaymentTerms)}
                  >
                    <option value="advance">In advance</option>
                    <option value="cod">Cash on delivery</option>
                    <option value="days">On credit</option>
                  </select>
                )}
              </Field>
              {terms === "days" && (
                <Field label="Days to pay" error={action.at("paymentDays")}>
                  {(field) => (
                    <input
                      {...field}
                      className={INPUT}
                      inputMode="numeric"
                      value={days}
                      onChange={(event) => setDays(event.target.value)}
                    />
                  )}
                </Field>
              )}
            </div>
            {terms === "days" && (
              <Field label="Credit limit (₱, optional)" error={action.at("creditLimit")}>
                {(field) => (
                  <input
                    {...field}
                    className={INPUT}
                    inputMode="decimal"
                    value={credit}
                    onChange={(event) => setCredit(event.target.value)}
                  />
                )}
              </Field>
            )}
          </div>
        )}

        {!now && !props.can.manage && (
          <div className="text-xs text-slate-500">
            You can use this customer at once. Management looks the details over afterwards.
          </div>
        )}
        {fileProblem && <div className="text-[13px] text-bad">{fileProblem}</div>}
        <Problem
          message={action.general([
            "name",
            "phone",
            "city",
            "email",
            "licenceExpires",
            "paymentDays",
            "creditLimit",
          ])}
        />
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={props.onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={action.busy || blocked}
            title={blocked ? `Missing: ${lacking.join(", ")}` : undefined}
          >
            {action.busy ? "Saving…" : now ? "Save" : `Add ${label.toLowerCase()}`}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
