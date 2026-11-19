// Customers from a spreadsheet (docs/ERP-PLAN.md phase 4): pick a CSV (Excel: Save as CSV), see
// each row checked as if typed by hand (one customer per phone and kind, no twin by name and
// city), then add the good ones. Management and the Admin.

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

type Result = { row: number; name: string; ok: boolean; message: string | null };
type Answer = { applied: boolean; added: number; results: Result[] };

/** A CSV file as rows of named cells (quoted cells, commas and line breaks inside quotes). */
function parseCsv(text: string): Record<string, string>[] {
  const lines: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let n = 0; n < text.length; n++) {
    const char = text[n] as string;
    if (quoted) {
      if (char === '"' && text[n + 1] === '"') {
        cell += '"';
        n++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[n + 1] === "\n") n++;
      row.push(cell);
      lines.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    lines.push(row);
  }
  const [head, ...body] = lines.filter((one) => one.some((value) => value.trim()));
  if (!head) return [];
  return body.map((values) => Object.fromEntries(head.map((key, n) => [key.trim(), (values[n] ?? "").trim()])));
}

export function CustomersImportPage() {
  const queries = useQueryClient();
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [file, setFile] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function send(apply: boolean) {
    setBusy(true);
    setProblem(null);
    try {
      setAnswer(await api<Answer>("/api/customers/import", { body: { rows, apply } }));
      if (apply) await queries.invalidateQueries({ queryKey: ["customers"] });
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const good = answer?.results.filter((one) => one.ok).length ?? 0;
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <header>
        <Link to="/customers" className="text-xs text-slate-500 hover:underline">
          ← Customers
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Import customers from a sheet</h1>
        <p className="mt-1 text-[13px] text-slate-500">
          A CSV with a header row: <b>Name</b> and <b>Type</b> (hospital, doctor, patient, drugstore, distributor, government) are needed; Mobile, Email, Address, City,
          Specialty, LTO number, LTO expiry (YYYY-MM-DD), TIN and Note are read when there. Each row is checked as if typed by hand; nothing is kept until you add them.
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (event) => {
            const picked = event.target.files?.[0];
            if (!picked) return;
            setFile(picked.name);
            setAnswer(null);
            setRows(parseCsv(await picked.text()));
          }}
        />
        {rows.length > 0 && <span className="text-sm text-slate-600">{rows.length.toLocaleString("en-PH")} rows in {file}</span>}
        <div className="ml-auto flex gap-2">
          <button type="button" disabled={!rows.length || busy} onClick={() => send(false)} className="h-9 rounded-lg border border-slate-200 px-3 text-sm font-semibold disabled:opacity-40">
            Check
          </button>
          <button
            type="button"
            disabled={!answer || answer.applied || !good || busy}
            onClick={() => send(true)}
            className="h-9 rounded-lg bg-brand px-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            Add {good ? good.toLocaleString("en-PH") : ""} customers
          </button>
        </div>
      </div>
      {problem && <p className="text-sm text-rose-700">{problem}</p>}
      {answer && (
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3 text-sm">
            {answer.applied ? (
              <b className="text-emerald-700">{answer.added.toLocaleString("en-PH")} customers added.</b>
            ) : (
              <>
                <b>{good.toLocaleString("en-PH")}</b> can be added · <b className="text-rose-700">{(answer.results.length - good).toLocaleString("en-PH")}</b> can't (fix them in the sheet and check again)
              </>
            )}
          </div>
          <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto text-sm">
            {answer.results
              .filter((one) => !one.ok)
              .map((one) => (
                <li key={one.row} className="flex gap-3 px-4 py-2">
                  <span className="w-16 shrink-0 text-slate-500">Row {one.row}</span>
                  <span className="w-56 shrink-0 truncate font-medium">{one.name || "—"}</span>
                  <span className="text-rose-700">{one.message}</span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
