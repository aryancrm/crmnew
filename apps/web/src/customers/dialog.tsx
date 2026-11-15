// Adding or changing a customer. While a name or number is typed it asks the API whether this
// is someone already on file, so the same hospital or patient isn't added twice.

import { formatPhone } from "@2mg/api/phone";
import type {
  CustomerCan,
  CustomerDetail,
  CustomerKind,
  CustomerList,
  CustomerMatch,
  PaymentTerms,
} from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Button, Dialog, Field, INPUT, Problem, useAction } from "../ui";

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
  const [note, setNote] = useState(now?.note ?? "");
  const [areaId, setAreaId] = useState(String(now?.areaId ?? ""));
  const [terms, setTerms] = useState<PaymentTerms>(now?.paymentTerms ?? "advance");
  const [days, setDays] = useState(String(now?.paymentDays ?? ""));
  const [credit, setCredit] = useState(now?.creditLimit ? String(now.creditLimit / 100) : "");

  const business = kind !== "patient";
  const typed = useSettled({ name: name.trim(), phone: phone.trim(), kind });
  const check = useQuery({
    queryKey: ["customers", "check", typed],
    queryFn: async () =>
      (
        await api<{ matches: CustomerMatch[] }>(
          `/api/customers/check?kind=${typed.kind}&name=${encodeURIComponent(typed.name)}&phone=${encodeURIComponent(typed.phone)}`,
        )
      ).matches,
    enabled: !now && (typed.name.length >= 3 || typed.phone.replace(/\D/g, "").length >= 7),
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
    await queries.invalidateQueries({ queryKey: ["customers"] });
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
                  {match.why === "phone" ? " · same number" : ""}
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
        {/* What isn't needed to place an order, folded: open it to add more. */}
        <details
          open={Boolean(address || specialty || licenceNo || licenceExpires || tin || note)}
          className="group rounded-xl border border-slate-200 bg-white"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900">
            More details
            <span className="text-[11px] font-normal text-slate-400">
              Address{business ? (kind === "doctor" ? ", PRC licence" : ", LTO, TIN") : ""}, note ·
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
            {business && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={kind === "doctor" ? "PRC licence no." : "LTO number"}>
                  {(field) => (
                    <input
                      {...field}
                      className={INPUT}
                      value={licenceNo}
                      onChange={(event) => setLicenceNo(event.target.value)}
                    />
                  )}
                </Field>
                <Field label="Valid until" error={action.at("licenceExpires")}>
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
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Saving…" : now ? "Save" : `Add ${label.toLowerCase()}`}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
