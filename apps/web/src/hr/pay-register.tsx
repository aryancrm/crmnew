// HR's own payroll register beside the CRM's month (on the Payroll month page): HR uploads its
// register (.xlsx), maps once which heading holds what (kept for the next months), confirms names
// the CRM matched by name only, and reads per person and per figure the CRM's amount, HR's and
// the difference; any ₱0.01 is flagged. Every file and comparison is kept. The CEO reads.

import type { PayRegisterPage, RegisterField, RegisterMapping } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, RefreshCw, Upload } from "lucide-react";
import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { FIELD } from "../org/dialogs";
import { Button, CARD, Pill, Problem, peso, useAction } from "../ui";

const FIELD_WORDS: Record<RegisterField, string> = {
  code: "Employee ID",
  name: "Name",
  basic: "Basic pay",
  ot: "Overtime",
  gross: "Gross pay",
  deductions: "Total deductions",
  sss: "SSS",
  philhealth: "PhilHealth",
  pagibig: "Pag-IBIG",
  tax: "Withholding tax",
  net: "Net pay",
};
const FIELDS = Object.keys(FIELD_WORDS) as RegisterField[];
/** A first guess of each field's heading, from the words HR's register uses. */
const GUESS: Record<RegisterField, RegExp> = {
  code: /^(emp(loyee)?\.?\s*(no|id|#|code)|id\s*no)/i,
  name: /(employee\s*)?name/i,
  basic: /basic/i,
  ot: /^ot\b|overtime/i,
  gross: /gross/i,
  deductions: /^(total\s*)?deductions?$/i,
  sss: /^sss\b/i,
  philhealth: /phil\s*health|phic/i,
  pagibig: /pag-?ibig|hdmf/i,
  tax: /^(w\/?tax|tax|withholding)/i,
  net: /net/i,
};
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
const signed = (centavos: number) => `${centavos > 0 ? "+" : centavos < 0 ? "−" : ""}${peso(Math.abs(centavos))}`;

export function RegisterCompareBox({ month }: { month: string }) {
  const queries = useQueryClient();
  const [picked, setPicked] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ["payroll", month, "register", picked],
    queryFn: () =>
      api<PayRegisterPage>(`/api/hr/payroll/${month}/register${picked ? `?register=${picked}` : ""}`),
  });
  const upload = useAction();
  const again = useAction();
  const file = useRef<HTMLInputElement>(null);
  const [mapping, setMapping] = useState(false);
  const [onlyDiffs, setOnlyDiffs] = useState(true);
  const refresh = () => queries.invalidateQueries({ queryKey: ["payroll", month, "register"] });
  const data = query.data;
  if (!data) return null;
  const current = data.current;
  const compare = current?.compare ?? null;

  async function send(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    const form = new FormData();
    form.set("file", chosen);
    const done = await upload.run(() => api(`/api/hr/payroll/${month}/register`, { body: form }));
    if (done) {
      setPicked(null);
      await refresh();
    }
  }

  return (
    <section className={`${CARD} flex flex-col gap-3 p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">HR's register beside the CRM</h2>
          <p className="text-xs text-slate-500">
            Upload HR's own payroll register for the month: every figure is compared to the centavo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.registers.length > 1 && (
            <select
              value={current?.id ?? ""}
              onChange={(event) => setPicked(Number(event.target.value) || null)}
              className={`${FIELD} h-8 w-auto text-xs`}
              aria-label="Which upload"
            >
              {data.registers.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.fileName} · {when(one.at)}
                </option>
              ))}
            </select>
          )}
          {current && (
            <a href={`/api/hr/payroll/register/${current.id}/file`} download>
              <Button small>
                <Download size={14} /> File
              </Button>
            </a>
          )}
          {data.can.upload && current?.fits && (
            <Button small onClick={() => setMapping(!mapping)}>
              {mapping ? "Close the mapping" : "Change the mapping"}
            </Button>
          )}
          {data.can.upload && current?.fits && (
            <Button
              small
              disabled={again.busy}
              onClick={async () => {
                if (await again.run(() => api(`/api/hr/payroll/register/${current.id}/compare`, { body: {} })))
                  await refresh();
              }}
            >
              <RefreshCw size={14} /> Compare again
            </Button>
          )}
          {data.can.upload && (
            <>
              <input ref={file} type="file" accept=".xlsx" className="hidden" onChange={send} />
              <Button small variant="primary" disabled={upload.busy} onClick={() => file.current?.click()}>
                <Upload size={14} /> {upload.busy ? "Uploading…" : "Upload register"}
              </Button>
            </>
          )}
        </div>
      </div>
      <Problem message={upload.problem?.message ?? again.problem?.message} />
      {!current && <p className="text-sm text-slate-500">No register uploaded for this month yet.</p>}
      {current && (!current.fits || mapping) && data.can.upload && (
        <MappingForm
          page={data}
          onDone={async () => {
            setMapping(false);
            await refresh();
          }}
        />
      )}
      {current && !current.fits && !data.can.upload && (
        <p className="text-sm text-slate-500">HR hasn't mapped this file's headings yet.</p>
      )}
      {compare && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <Pill tone={compare.differences ? "bad" : "good"}>
              {compare.differences ? `${compare.differences} to look at` : "Matches to the centavo"}
            </Pill>
            <span>
              Compared {when(compare.at)} by {compare.by}, against the CRM's{" "}
              {compare.crmStatus === "released" ? "released payslips" : "draft as it stood"}
            </span>
            <label className="ml-auto flex items-center gap-1.5">
              <input type="checkbox" checked={onlyDiffs} onChange={(event) => setOnlyDiffs(event.target.checked)} />
              Only people with a difference
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm [&_td]:whitespace-nowrap">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  <th className="px-2 py-2">Person</th>
                  {compare.fields.map((field) => (
                    <th key={field} className="px-2 py-2 text-right">
                      {FIELD_WORDS[field]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {compare.rows
                  .filter((one) => !onlyDiffs || one.differs)
                  .map((one) => (
                    <tr key={one.row} className={one.differs ? "bg-rose-50/40" : ""}>
                      <td className="px-2 py-2">
                        <div className="font-semibold text-slate-900">{one.name}</div>
                        <div className="text-xs text-slate-500">
                          Row {one.row} · {one.match === "code" ? `by ID ${one.code}` : `by name (${one.hrName})`}
                        </div>
                      </td>
                      {one.figures.map((f) => (
                        <td key={f.field} className="px-2 py-2 text-right tabular-nums">
                          <div className="text-slate-800">{peso(f.crm)}</div>
                          {f.diff === 0 ? (
                            <div className="text-xs text-emerald-700">same</div>
                          ) : (
                            <div className="text-xs font-semibold text-rose-700">
                              HR {f.hr === null ? "unreadable" : peso(f.hr)}
                              {f.diff !== null ? ` · ${signed(f.diff)}` : ""}
                            </div>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                {compare.rows.filter((one) => !onlyDiffs || one.differs).length === 0 && (
                  <tr>
                    <td colSpan={compare.fields.length + 1} className="px-2 py-4 text-center text-sm text-slate-500">
                      {compare.rows.length ? "Every matched person agrees to the centavo." : "Nobody matched yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <OneSide page={data} registerId={current?.id as number} onDone={refresh} />
        </div>
      )}
    </section>
  );
}

function OneSide({
  page,
  registerId,
  onDone,
}: {
  page: PayRegisterPage;
  registerId: number;
  onDone: () => Promise<unknown>;
}) {
  const compare = page.current?.compare;
  const action = useAction();
  const [chosen, setChosen] = useState<Record<number, number>>({});
  if (!compare) return null;
  const confirm = async (row: number, personId: number) => {
    if (await action.run(() => api(`/api/hr/payroll/register/${registerId}/confirm`, { body: { row, personId } })))
      await onDone();
  };
  const open = new Set([
    ...compare.onlyCrm.map((one) => one.personId),
    ...compare.toConfirm.map((one) => one.personId),
  ]);
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px]">
        <h3 className="mb-1 font-semibold text-amber-900">Matched by name: is it them? ({compare.toConfirm.length})</h3>
        {compare.toConfirm.length === 0 && <p className="text-amber-800">None.</p>}
        <ul className="flex flex-col gap-1.5">
          {compare.toConfirm.map((one) => (
            <li key={one.row} className="flex items-center justify-between gap-2">
              <span>
                Row {one.row}: {one.hrName}
                {one.code ? ` (${one.code})` : ""}
              </span>
              {page.can.upload && (
                <Button small disabled={action.busy} onClick={() => confirm(one.row, one.personId)}>
                  This is {one.name}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-lg border border-slate-200 p-3 text-[13px]">
        <h3 className="mb-1 font-semibold text-slate-900">Only on HR's register ({compare.onlyHr.length})</h3>
        {compare.onlyHr.length === 0 && <p className="text-slate-500">None.</p>}
        <ul className="flex flex-col gap-1.5">
          {compare.onlyHr.map((one) => (
            <li key={one.row} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Row {one.row}: {one.hrName ?? "no name"}
                {one.code ? ` (${one.code})` : ""}
              </span>
              {page.can.upload && open.size > 0 && (
                <span className="flex items-center gap-1">
                  <select
                    value={chosen[one.row] ?? ""}
                    onChange={(event) => setChosen({ ...chosen, [one.row]: Number(event.target.value) })}
                    className={`${FIELD} h-8 w-40 text-xs`}
                    aria-label={`Who row ${one.row} is`}
                  >
                    <option value="">Who is it?</option>
                    {page.people
                      .filter((person) => open.has(person.id))
                      .map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                        </option>
                      ))}
                  </select>
                  <Button
                    small
                    disabled={action.busy || !chosen[one.row]}
                    onClick={() => confirm(one.row, chosen[one.row] as number)}
                  >
                    Match
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-lg border border-slate-200 p-3 text-[13px]">
        <h3 className="mb-1 font-semibold text-slate-900">Only in the CRM ({compare.onlyCrm.length})</h3>
        {compare.onlyCrm.length === 0 && <p className="text-slate-500">None.</p>}
        <ul className="flex flex-col gap-0.5">
          {compare.onlyCrm.map((one) => (
            <li key={one.personId}>
              {one.name}
              {one.code ? ` (${one.code})` : " (no employee ID)"}
            </li>
          ))}
        </ul>
      </div>
      <div className="lg:col-span-3">
        <Problem message={action.problem?.message} />
      </div>
    </div>
  );
}

function MappingForm({ page, onDone }: { page: PayRegisterPage; onDone: () => Promise<void> }) {
  const current = page.current;
  const action = useAction();
  const sheets = current?.sheets ?? [];
  const inForce = current?.mapping ?? null;
  const firstSheet =
    sheets.find((one) => one.name === inForce?.sheet)?.name ??
    sheets.find((one) => one.rows.length > 1)?.name ??
    sheets[0]?.name ??
    "";
  const [sheetName, setSheetName] = useState(firstSheet);
  const sheet = sheets.find((one) => one.name === sheetName);
  const [headerRow, setHeaderRow] = useState<number>(
    inForce && inForce.sheet === firstSheet ? inForce.headerRow : (sheet?.guessedRow ?? 1),
  );
  const headings = useMemo(
    () => [...new Set((sheet?.rows.find((one) => one.number === headerRow)?.cells ?? []).map((one) => one.trim()).filter(Boolean))],
    [sheet, headerRow],
  );
  const guessed = (field: RegisterField) => {
    const kept = inForce?.columns[field];
    if (kept && headings.includes(kept)) return kept;
    return headings.find((one) => GUESS[field].test(one)) ?? "";
  };
  const [columns, setColumns] = useState<Partial<Record<RegisterField, string>>>({});
  const valueOf = (field: RegisterField) => columns[field] ?? guessed(field);
  async function save() {
    const body: RegisterMapping = {
      sheet: sheetName,
      headerRow,
      columns: Object.fromEntries(FIELDS.map((field) => [field, valueOf(field) || null])),
    };
    if (await action.run(() => api(`/api/hr/payroll/register/${current?.id}/map`, { body }))) await onDone();
  }
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-sky-200 bg-sky-50/50 p-3">
      <p className="text-[13px] text-slate-700">
        {current?.fits
          ? "The mapping in force fits this file. A new one is kept and used for the next files."
          : inForce
            ? "This file's headings aren't where the mapping in force expects them: map them again."
            : "Say once which heading holds what. It is kept and used for the next months' files."}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          Sheet
          <select
            value={sheetName}
            onChange={(event) => {
              setSheetName(event.target.value);
              setHeaderRow(sheets.find((one) => one.name === event.target.value)?.guessedRow ?? 1);
              setColumns({});
            }}
            className={FIELD}
          >
            {sheets.map((one) => (
              <option key={one.name} value={one.name}>
                {one.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          The headings are on row
          <select
            value={headerRow}
            onChange={(event) => {
              setHeaderRow(Number(event.target.value));
              setColumns({});
            }}
            className={FIELD}
          >
            {(sheet?.rows ?? []).map((one) => (
              <option key={one.number} value={one.number}>
                {one.number}: {one.cells.filter(Boolean).slice(0, 5).join(" · ").slice(0, 70)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {FIELDS.map((field) => (
          <label key={field} className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            {FIELD_WORDS[field]}
            <select
              value={valueOf(field)}
              onChange={(event) => setColumns({ ...columns, [field]: event.target.value })}
              className={FIELD}
            >
              <option value="">Not in the file</option>
              {headings.map((one) => (
                <option key={one} value={one}>
                  {one}
                </option>
              ))}
            </select>
            {action.at(field) && <span className="font-medium text-rose-700">{action.at(field)}</span>}
          </label>
        ))}
      </div>
      <Problem message={action.general(["sheet", "headerRow", ...FIELDS])} />
      <div className="flex justify-end">
        <Button variant="primary" small disabled={action.busy} onClick={save}>
          {action.busy ? "Comparing…" : "Keep the mapping and compare"}
        </Button>
      </div>
    </div>
  );
}
