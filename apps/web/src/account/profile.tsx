// My profile (/profile, /profile/security): each person's own. Who they are at the top, then in
// small groups (Miller): personal information, contact, emergency contact; what the company sets is
// beside them, only read. Each form's one Save is at its end, live once something changed.

import type { Profile, ProfileContact, ProfilePersonal } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ShieldAlert } from "lucide-react";
import { type FormEvent, type InputHTMLAttributes, useId, useRef, useState } from "react";
import { Link, NavLink, Navigate, useParams } from "react-router-dom";
import { api } from "../api";
import { ME, useMe } from "../auth";
import { smaller } from "../photo";
import { Button, dayLabel, Field, PageState, Problem, useAction } from "../ui";
import { Avatar } from "./avatar";
import { PROFILE, Section } from "./profile-parts";
import { ProfileSecurity } from "./profile-security";

const SUFFIXES = ["Jr.", "Sr.", "II", "III", "IV", "V"];

export function ProfilePage() {
  const { section } = useParams();
  const me = useMe().data;
  const query = useQuery({
    queryKey: PROFILE,
    queryFn: () => api<Profile>("/api/me/profile"),
    enabled: Boolean(me && !me.viewedBy),
  });
  if (!me || me.viewedBy) return <Navigate to="/" replace />;
  if (section && section !== "security") return <Navigate to="/profile" replace />;
  const data = query.data;
  if (!data) return <PageState query={query} what="your profile" />;
  const security = section === "security";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 [&_.field]:min-h-11">
      <Identity data={data} />
      <nav aria-label="Profile" className="flex gap-1 border-b border-slate-200">
        {(
          [
            ["/profile", "Profile"],
            ["/profile/security", "Security"],
          ] as const
        ).map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              `-mb-px flex min-h-11 items-center border-b-2 px-4 text-sm font-semibold ${isActive ? "border-brand text-brand-dark" : "border-transparent text-ink-2 hover:text-ink"}`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Kept while Security is open: what was typed here isn't lost by looking there. */}
      <div hidden={security}>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <Personal saved={data.personal} complete={data.complete} />
            <Contact saved={data.contact} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            {!data.security.twoStep.on && (
              <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <ShieldAlert className="size-4" aria-hidden="true" /> Protect your account
                </h2>
                <p className="mt-1 text-sm">Two-step sign-in is off. It takes a minute to set up.</p>
                <Link
                  to="/profile/security"
                  className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-brand-dark hover:underline"
                >
                  Set it up
                </Link>
              </section>
            )}
            <Work work={data.work} />
          </div>
        </div>
      </div>
      {security && <ProfileSecurity security={data.security} />}
    </div>
  );
}

function Identity({ data }: { data: Profile }) {
  const me = useMe().data;
  const queries = useQueryClient();
  const action = useAction();
  const input = useRef<HTMLInputElement>(null);
  if (!me) return null;

  async function refresh() {
    await Promise.all([queries.invalidateQueries({ queryKey: ME }), queries.invalidateQueries({ queryKey: PROFILE })]);
  }
  async function pick(file: File | undefined) {
    if (!file) return;
    await action.run(async () => {
      const form = new FormData();
      form.set("file", await smaller(file));
      await api("/api/me/photo", { body: form });
      await refresh();
    });
    if (input.current) input.current.value = "";
  }

  return (
    <section className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <button
        type="button"
        disabled={action.busy}
        onClick={() => input.current?.click()}
        aria-label="Change profile picture"
        title="Change profile picture"
        className="relative rounded-full disabled:opacity-60"
      >
        <Avatar person={{ id: me.id, name: data.name, photo: me.photo }} size="lg" />
        <span className="absolute right-0 bottom-0 grid size-8 place-items-center rounded-full border-2 border-white bg-slate-800 text-white">
          <Camera className="size-4" aria-hidden="true" />
        </span>
      </button>
      <div className="min-w-0 flex-1 basis-56">
        <h1 className="text-2xl leading-8 font-bold tracking-tight wrap-break-word text-ink">{data.name}</h1>
        <p className="text-sm text-ink-2">
          {me.roleLabel}
          {data.work.team && data.work.team !== me.roleLabel ? ` · ${data.work.team}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button small className="border border-slate-300" disabled={action.busy} onClick={() => input.current?.click()}>
            {action.busy ? "Saving…" : me.photo ? "Change photo" : "Upload photo"}
          </Button>
          {me.photo && (
            <Button
              small
              variant="danger"
              disabled={action.busy}
              onClick={() =>
                action.run(async () => {
                  await api("/api/me/photo/remove", { body: {} });
                  await refresh();
                })
              }
            >
              Remove
            </Button>
          )}
          <span className="text-xs text-ink-2">JPG, PNG or WebP, up to 8 MB</span>
        </div>
        {action.problem && (
          <div className="mt-2">
            <Problem message={action.problem.message} />
          </div>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(event) => void pick(event.target.files?.[0])}
      />
    </section>
  );
}

function Input({
  label,
  error,
  value,
  onValue,
  ...more
}: {
  label: string;
  error?: string;
  value: string;
  onValue: (value: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <Field label={label} error={error}>
      {(props) => <input {...more} {...props} value={value} onChange={(event) => onValue(event.target.value)} className="field" />}
    </Field>
  );
}

function SaveBar({ changed, busy, saved }: { changed: boolean; busy: boolean; saved: boolean }) {
  return (
    <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
      <span role="status" className="text-sm text-good">
        {saved && !changed ? "Saved" : ""}
      </span>
      <Button type="submit" variant="primary" disabled={!changed || busy}>
        {busy ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}

function Personal({ saved, complete }: { saved: ProfilePersonal; complete: boolean }) {
  const queries = useQueryClient();
  const action = useAction();
  const [form, setForm] = useState(saved);
  const [base, setBase] = useState(saved);
  const [done, setDone] = useState(false);
  const set = (change: Partial<ProfilePersonal>) => setForm((now) => ({ ...now, ...change }));
  const changed = JSON.stringify(form) !== JSON.stringify(base);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setDone(false);
    const ok = await action.run(async () => {
      await api("/api/me/profile/personal", { body: form });
      setBase(form);
      // The name is on many screens.
      await queries.invalidateQueries();
    });
    setDone(ok);
  }

  return (
    <Section
      title="Personal information"
      note={complete ? "Colleagues see your name. Your birth date is seen only by you, HR, the CEO and the Admin." : "Add your full name and birth date to complete your profile."}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Input label="First name" autoComplete="given-name" maxLength={60} required value={form.firstName} onValue={(firstName) => set({ firstName })} error={action.at("firstName")} />
          <Input label="Middle name (optional)" autoComplete="additional-name" maxLength={60} value={form.middleName ?? ""} onValue={(middleName) => set({ middleName: middleName || null })} error={action.at("middleName")} />
          <Input label="Last name" autoComplete="family-name" maxLength={60} required value={form.lastName} onValue={(lastName) => set({ lastName })} error={action.at("lastName")} />
          <Field label="Suffix (optional)" error={action.at("suffix")}>
            {(props) => (
              <select
                {...props}
                autoComplete="honorific-suffix"
                value={form.suffix ?? ""}
                onChange={(event) => set({ suffix: event.target.value || null })}
                className="field"
              >
                <option value="">None</option>
                {SUFFIXES.map((one) => (
                  <option key={one}>{one}</option>
                ))}
              </select>
            )}
          </Field>
          <Input label="Birth date" type="date" autoComplete="bday" required value={form.birthDate} onValue={(birthDate) => set({ birthDate })} error={action.at("birthDate")} />
        </div>
        <Problem message={action.general(["firstName", "middleName", "lastName", "suffix", "birthDate"])} />
        <SaveBar changed={changed} busy={action.busy} saved={done} />
      </form>
    </Section>
  );
}

function Contact({ saved }: { saved: ProfileContact }) {
  const queries = useQueryClient();
  const action = useAction();
  const [form, setForm] = useState(saved);
  const [base, setBase] = useState(saved);
  const [done, setDone] = useState(false);
  const emergency = useId();
  const changed = JSON.stringify(form) !== JSON.stringify(base);
  const field = (key: keyof ProfileContact) => ({
    value: form[key] ?? "",
    onValue: (value: string) => setForm((now) => ({ ...now, [key]: value || null })),
    error: action.at(key),
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setDone(false);
    const ok = await action.run(async () => {
      await api("/api/me/profile/contact", { body: form });
      setBase(form);
      await queries.invalidateQueries({ queryKey: PROFILE });
    });
    setDone(ok);
  }

  return (
    <Section title="Contact details" note="Seen only by you, HR, the CEO and the Admin. Your lead also sees your mobile number.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Input label="Mobile number" type="tel" autoComplete="tel" maxLength={30} {...field("mobile")} />
          <Input label="Personal email" type="email" autoComplete="email" maxLength={200} {...field("personalEmail")} />
          <div className="min-w-0 sm:col-span-2">
            <Input label="Home address" autoComplete="street-address" maxLength={400} {...field("address")} />
          </div>
        </div>
        <div role="group" aria-labelledby={emergency} className="flex flex-col gap-3 border-t border-slate-100 pt-4">
          <h3 id={emergency} className="text-sm font-semibold text-ink">
            Emergency contact
          </h3>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Input label="Contact's name" autoComplete="off" maxLength={120} {...field("emergencyName")} />
            <Input label="Contact's number" type="tel" autoComplete="off" maxLength={30} {...field("emergencyPhone")} />
            <Input label="Relationship" autoComplete="off" maxLength={60} {...field("emergencyRelation")} />
          </div>
        </div>
        <Problem
          message={action.general(["mobile", "personalEmail", "address", "emergencyName", "emergencyPhone", "emergencyRelation"])}
        />
        <SaveBar changed={changed} busy={action.busy} saved={done} />
      </form>
    </Section>
  );
}

function Work({ work }: { work: Profile["work"] }) {
  const facts = [
    ["Login ID", work.loginId],
    ["Position", work.position],
    ["Team", work.team],
    ["Reports to", work.reportsTo],
    ["Employee ID", work.employeeCode],
    ["Hired", work.hireDate ? dayLabel(work.hireDate) : null],
  ] as const;
  return (
    <Section title="Work details" note="Set by HR and your administrator.">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-ink-2">{label}</dt>
            <dd className="mt-0.5 text-sm font-medium wrap-break-word text-ink">{value ?? "Not set"}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
