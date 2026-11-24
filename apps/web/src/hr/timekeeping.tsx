// HR's Timekeeping: the biometric workbook each cut-off. HR picks the file and the CRM reads it
// first (nothing is kept): the days it covers, each row with who it is (by the device ID HR set,
// or the employee ID), a name that only looks like someone's waiting for "This is …", and the days
// that can't be read. Then the import keeps the matched rows' days beside the CRM's attendance,
// never over it. Needs review lists the days to look at across everyone: use the biometric times
// or dismiss the flag with a note. The CEO reads.

import type { BiometricDay, TimekeepingPage as Page, TimekeepingPreview } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, Upload } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Button, CARD, Dialog, Field, INPUT, PageHead, PageState, Problem, useAction } from "../ui";
import { clock } from "./parts";

const dayWords = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const rangeWords = (from: string, to: string) => `${dayWords(from)} – ${dayWords(to)}`;

/** A biometric cell in a few characters: "08:00–17:00", "08:05 –", "OFF", "?". */
export function sheetWords(day: Pick<BiometricDay, "kind" | "firstIn" | "lastOut" | "code" | "raw">): string {
  if (day.kind === "punch") return `${day.firstIn}–${day.lastOut ?? ""}`;
  if (day.kind === "code") return day.code ?? day.raw;
  if (day.kind === "empty") return "—";
  return day.raw || "?";
}

const HOW: Record<"device" | "employee_id", string> = {
  device: "by device ID",
  employee_id: "by employee ID",
};

export function TimekeepingPage() {
  const query = useQuery({
    queryKey: ["hr", "timekeeping"],
    queryFn: () => api<Page>("/api/hr/timekeeping"),
  });
  const [open, setOpen] = useState<{ day: BiometricDay; name: string } | null>(null);
  const data = query.data;
  if (!data) return <PageState query={query} what="the timekeeping" />;
  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="Timekeeping"
        sub="The biometric workbook (its TIMEKEEPING sheet), any run of days. It is read first and nothing is kept until you import; the CRM's own attendance is never written over."
      />
      {data.can.upload && <ImportCard />}
      <section className={`${CARD} overflow-hidden`}>
        <h2 className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900">
          <span>Needs review</span>
          {data.range && (
            <span className="text-xs font-normal text-slate-500">{rangeWords(data.range.from, data.range.to)}</span>
          )}
        </h2>
        {data.review.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">
            {data.range ? "Nothing to review: the biometrics and the CRM agree." : "No workbook imported yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  <th className="px-4 py-2">Person</th>
                  <th className="px-3 py-2">Day</th>
                  <th className="px-3 py-2">Biometrics</th>
                  <th className="px-3 py-2">CRM</th>
                  <th className="px-3 py-2">Why</th>
                  {data.can.upload && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.review.map((one) => (
                  <tr key={one.biometric.id}>
                    <td className="px-4 py-2">
                      <Link
                        to={`/hr/attendance/${one.person.id}?month=${one.biometric.day.slice(0, 7)}`}
                        className="font-medium text-slate-800 hover:text-emerald-700"
                      >
                        {one.person.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{dayWords(one.biometric.day)}</td>
                    <td className="px-3 py-2 tabular-nums" title={`Cell ${one.biometric.column}: ${one.biometric.raw}`}>
                      {sheetWords(one.biometric)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {one.crm ? `${clock(one.crm.timeIn)} – ${clock(one.crm.timeOut)}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-amber-800">
                      {[one.biometric.review, one.biometric.flag].filter(Boolean).join(" · ")}
                    </td>
                    {data.can.upload && (
                      <td className="px-3 py-2 text-right">
                        <Button small onClick={() => setOpen({ day: one.biometric, name: one.person.name })}>
                          Review
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <Imports data={data} />
      <Devices data={data} />
      {open && <BiometricDialog name={open.name} day={open.day} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ImportCard() {
  const queries = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<TimekeepingPreview | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const reading = useAction();
  const importing = useAction();
  const form = () => {
    const out = new FormData();
    if (file) out.set("file", file);
    return out;
  };
  async function readIt(event?: FormEvent) {
    event?.preventDefault();
    setDone(null);
    await reading.run(async () => {
      setPreview(await api<TimekeepingPreview>("/api/hr/timekeeping/preview", { body: form() }));
    });
  }
  async function importIt() {
    const ok = await importing.run(async () => {
      const made = await api<{ people: number; days: number; needsReview: number; skipped: number }>(
        "/api/hr/timekeeping/import",
        { body: form() },
      );
      setDone(
        `Imported ${made.people} ${made.people === 1 ? "person" : "people"}, ${made.days} days (${made.needsReview} to review)${made.skipped ? `; ${made.skipped} left out` : ""}.`,
      );
    });
    if (ok) {
      setPreview(null);
      setFile(null);
      await queries.invalidateQueries({ queryKey: ["hr", "timekeeping"] });
      await queries.invalidateQueries({ queryKey: ["attendance"] });
    }
  }
  return (
    <section className={`${CARD} flex flex-col gap-3 p-4`}>
      <form onSubmit={readIt} className="flex flex-wrap items-end gap-3">
        <Field label="Timekeeping workbook (.xlsx, up to 10 MB)" error={reading.at("file")}>
          {(field) => (
            <input
              {...field}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="text-sm text-slate-600 file:mr-3 file:cursor-pointer file:rounded-[10px] file:border file:border-solid file:border-line file:bg-white file:px-3 file:py-2 file:text-[13px] file:font-semibold file:text-slate-700 file:shadow-sm hover:file:bg-hover"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setPreview(null);
                setDone(null);
              }}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" disabled={!file || reading.busy}>
          <FileSpreadsheet size={15} /> {reading.busy ? "Reading…" : "Read the workbook"}
        </Button>
      </form>
      <Problem message={reading.general(["file"])} />
      {done && <p className="text-sm font-medium text-emerald-700">{done}</p>}
      {preview && (
        <PreviewPanel
          preview={preview}
          onMatched={() => readIt()}
          onImport={importIt}
          busy={importing.busy || reading.busy}
          problem={importing.general([])}
        />
      )}
    </section>
  );
}

function PreviewPanel({
  preview,
  onMatched,
  onImport,
  busy,
  problem,
}: {
  preview: TimekeepingPreview;
  onMatched: () => void;
  onImport: () => void;
  busy: boolean;
  problem: string | null;
}) {
  const queries = useQueryClient();
  const matching = useAction();
  const [picked, setPicked] = useState<Record<number, string>>({});
  async function match(deviceId: string, personId: number, nameOnSheet: string) {
    const ok = await matching.run(() =>
      api("/api/hr/timekeeping/devices", { body: { deviceId, personId, nameOnSheet } }),
    );
    if (ok) {
      await queries.invalidateQueries({ queryKey: ["hr", "timekeeping"] });
      onMatched();
    }
  }
  const counts = preview.counts;
  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-700">
          <span className="font-semibold text-slate-900">{rangeWords(preview.from, preview.to)}</span> ·{" "}
          {counts.matched} of {counts.people} matched
          {counts.suggested ? ` · ${counts.suggested} to confirm` : ""} · {counts.days} days
          {counts.review ? ` · ${counts.review} to review` : ""}
        </div>
        <Button variant="primary" disabled={busy || counts.matched === 0} onClick={onImport}>
          <Upload size={15} /> Import {counts.matched} {counts.matched === 1 ? "person" : "people"}
        </Button>
      </div>
      {preview.warnings.length > 0 && (
        <ul className="list-disc rounded-lg bg-amber-50 px-6 py-2 text-xs text-amber-900">
          {preview.warnings.map((one) => (
            <li key={one}>{one}</li>
          ))}
        </ul>
      )}
      <Problem message={problem ?? matching.general([])} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <th className="px-2 py-2">Row</th>
              <th className="px-2 py-2">Device ID</th>
              <th className="px-2 py-2">On the sheet</th>
              <th className="px-2 py-2">In the CRM</th>
              <th className="px-2 py-2">Days</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 align-top">
            {preview.people.map((one) => (
              <tr key={one.row} className={one.match && !one.problem ? "" : "bg-slate-50/60"}>
                <td className="px-2 py-2 text-xs text-slate-500 tabular-nums">{one.row}</td>
                <td className="px-2 py-2 tabular-nums">{one.deviceId || "—"}</td>
                <td className="px-2 py-2">
                  {one.name || "—"}
                  {one.employeeCode && <div className="text-xs text-slate-500">{one.employeeCode}</div>}
                </td>
                <td className="px-2 py-2">
                  {one.match ? (
                    <span>
                      <span className="font-medium text-slate-900">{one.match.name}</span>{" "}
                      <span className="text-xs text-slate-500">{HOW[one.match.how]}</span>
                    </span>
                  ) : one.suggestion && one.deviceId ? (
                    <Button
                      small
                      disabled={busy || matching.busy}
                      onClick={() => match(one.deviceId, one.suggestion?.personId as number, one.name)}
                    >
                      This is {one.suggestion.name}
                    </Button>
                  ) : one.deviceId ? (
                    <span className="flex items-center gap-1.5">
                      <select
                        aria-label={`Who row ${one.row} is`}
                        className={`${INPUT} h-8 max-w-48 text-sm`}
                        value={picked[one.row] ?? ""}
                        onChange={(event) => setPicked({ ...picked, [one.row]: event.target.value })}
                      >
                        <option value="">Nobody matched: pick…</option>
                        {preview.choices.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name}
                            {person.employeeCode ? ` (${person.employeeCode})` : ""}
                          </option>
                        ))}
                      </select>
                      <Button
                        small
                        disabled={!picked[one.row] || busy || matching.busy}
                        onClick={() => match(one.deviceId, Number(picked[one.row]), one.name)}
                      >
                        Match
                      </Button>
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500">Left out: no device ID</span>
                  )}
                  {one.problem && <div className="mt-1 text-xs text-rose-700">{one.problem}</div>}
                  {!one.match && <div className="mt-1 text-xs text-slate-500">Not imported until matched</div>}
                </td>
                <td className="px-2 py-2">
                  <div className="flex flex-wrap gap-1">
                    {one.days.map((day) => (
                      <span
                        key={day.day}
                        title={`${dayWords(day.day)} (cell ${day.column}): ${day.raw || "empty"}${day.review ? ` · ${day.review}` : ""}`}
                        className={`rounded px-1 text-[11px] tabular-nums ring-1 ${
                          day.review
                            ? "bg-amber-50 text-amber-900 ring-amber-200"
                            : day.kind === "punch"
                              ? "bg-white text-slate-700 ring-slate-200"
                              : "bg-slate-50 text-slate-500 ring-slate-200"
                        }`}
                      >
                        {Number(day.day.slice(8, 10))}: {sheetWords(day)}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Imports({ data }: { data: Page }) {
  if (!data.imports.length) return null;
  return (
    <section className={`${CARD} overflow-hidden`}>
      <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900">Imports</h2>
      <ul className="divide-y divide-slate-100 text-sm">
        {data.imports.map((one) => (
          <li key={one.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <div className={one.superseded ? "text-slate-500" : "font-medium text-slate-900"}>
                {rangeWords(one.from, one.to)}
                {one.superseded && (
                  <span className="ml-2 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                    Imported again since
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500">
                {one.people} people · {one.days} days · {one.needsReview} to review
                {one.skipped ? ` · ${one.skipped} left out` : ""} · {one.madeBy},{" "}
                {new Date(one.madeAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}
              </div>
            </div>
            <a
              href={`/api/hr/timekeeping/imports/${one.id}/file`}
              className="text-xs font-semibold text-emerald-700 hover:underline"
            >
              {one.fileName}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Devices({ data }: { data: Page }) {
  const queries = useQueryClient();
  const action = useAction();
  if (!data.devices.length) return null;
  async function takeOff(id: number) {
    if (await action.run(() => api(`/api/hr/timekeeping/devices/${id}/archive`, { body: {} })))
      await queries.invalidateQueries({ queryKey: ["hr", "timekeeping"] });
  }
  return (
    <section className={`${CARD} overflow-hidden`}>
      <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900">
        Device IDs
        <span className="ml-2 text-xs font-normal text-slate-500">whose each biometric ID is, used every import</span>
      </h2>
      <Problem message={action.general([])} />
      <ul className="divide-y divide-slate-100 text-sm">
        {data.devices.map((one) => (
          <li key={one.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
            <span>
              <span className="font-medium text-slate-900 tabular-nums">{one.deviceId}</span>
              <span className="mx-2 text-slate-300">→</span>
              {one.person.name}
              {one.nameOnSheet && <span className="ml-2 text-xs text-slate-500">on the sheet: {one.nameOnSheet}</span>}
            </span>
            {data.can.upload && (
              <Button small variant="quiet" disabled={action.busy} onClick={() => takeOff(one.id)}>
                Take off
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A biometric day's flag: use its times for the CRM's day, or dismiss it with a note. */
export function BiometricDialog({
  name,
  day,
  onClose,
}: {
  name: string;
  day: BiometricDay;
  onClose: () => void;
}) {
  const queries = useQueryClient();
  const action = useAction();
  const [note, setNote] = useState("");
  const usable = day.kind === "punch" && Boolean(day.firstIn && day.lastOut);
  async function act(kind: "use" | "dismiss") {
    const ok = await action.run(() =>
      api(`/api/hr/timekeeping/days/${day.id}/${kind}`, { body: { note: note || null } }),
    );
    if (ok) {
      await queries.invalidateQueries({ queryKey: ["hr", "timekeeping"] });
      await queries.invalidateQueries({ queryKey: ["attendance"] });
      onClose();
    }
  }
  return (
    <Dialog
      title={`${name} · ${dayWords(day.day)}`}
      sub={`The biometric sheet: ${sheetWords(day)}${day.codeWords ? ` (${day.codeWords})` : ""} · cell ${day.column}: "${day.raw || "empty"}"`}
      onClose={onClose}
      busy={action.busy}
    >
      <div className="flex flex-col gap-4">
        {(day.review || day.flag) && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {[day.review, day.flag].filter(Boolean).join(" · ")}
          </p>
        )}
        {day.resolution ? (
          <p className="text-sm text-slate-600">
            {day.resolution.kind === "applied" ? "Its times were used" : "Dismissed"} by {day.resolution.by}
            {day.resolution.note ? `: ${day.resolution.note}` : ""}.
          </p>
        ) : (
          <>
            <Field label="Note (needed to dismiss)" error={action.at("note")}>
              {(field) => (
                <input
                  {...field}
                  className={INPUT}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Company training, a full day"
                  maxLength={200}
                />
              )}
            </Field>
            <Problem message={action.general(["note"])} />
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
              <Button onClick={() => act("dismiss")} disabled={action.busy}>
                Dismiss the flag
              </Button>
              <Button
                variant="primary"
                onClick={() => act("use")}
                disabled={action.busy || !usable}
                title={usable ? undefined : "The sheet hasn't both a time in and out: put the day right by hand"}
              >
                Use biometric times
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
