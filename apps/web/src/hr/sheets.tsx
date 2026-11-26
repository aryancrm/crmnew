// HR's sheets in and out (docs/HR-PLAN.md, "Documents, imports and reports", 26 Nov): each sheet's
// current data and blank template to download, and the import in four steps: choose the file,
// match its columns, a test run that changes nothing, then save. Every row says what changed or why
// it couldn't, with its line in the file.

import type { HrImportKind, HrImportRead, HrImportResult, HrImportRow, HrSheets } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { Button, Card, PageHead, PageState, Panel, Pill, Problem, useAction } from "../ui";

const LINK = "inline-flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-100";

/** Every sheet: download it as it is now, a blank template, or import one. */
export function SheetsPage() {
  const query = useQuery({ queryKey: ["hr", "sheets"], queryFn: () => api<HrSheets>("/api/hr/import") });
  const data = query.data;
  if (!data) return <PageState query={query} what="the sheets" />;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <PageHead
        title="Import & export"
        sub="Download a sheet, put it right in Excel and bring it back: the same columns go out and come in. A test run shows every change before anything is saved."
      />
      {data.kinds.map((kind) => (
        <Card key={kind.key} className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 max-w-2xl">
              <h2 className="flex items-center gap-2 font-semibold text-slate-900">
                <FileSpreadsheet size={16} aria-hidden="true" /> {kind.title}
              </h2>
              <p className="mt-1 text-sm text-slate-600">{kind.what}</p>
            </div>
            <div className="flex flex-wrap gap-1">
              <a className={LINK} href={`/api/hr/export/${kind.key}.xlsx`} download>
                <Download size={14} /> Download
              </a>
              <a className={LINK} href={`/api/hr/export/${kind.key}.xlsx?template=1`} download>
                <Download size={14} /> Blank template
              </a>
              {data.can.import && (
                <Link to={`/hr/import/${kind.key}`} className={`${LINK} bg-brand text-white hover:bg-brand-dark`}>
                  <Upload size={14} /> Import
                </Link>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {kind.columns.map((column) => (
              <span
                key={column.label}
                title={column.readOnly ? "Shown only: an import doesn't change it" : (column.note ?? undefined)}
                className={`rounded-full px-2 py-0.5 ${column.readOnly ? "bg-slate-50 text-slate-400" : "bg-slate-100 text-slate-700"}`}
              >
                {column.label}
              </span>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

const STATUS: Record<HrImportRow["status"], [string, "good" | "info" | "plain" | "bad" | "warn"]> = {
  new: ["New", "good"],
  update: ["Changes", "info"],
  same: ["Nothing to change", "plain"],
  problem: ["Problem", "bad"],
  not_found: ["Not found", "warn"],
};

/** The import, step by step. */
export function ImportPage() {
  const { kind = "people" } = useParams();
  const sheets = useQuery({ queryKey: ["hr", "sheets"], queryFn: () => api<HrSheets>("/api/hr/import") });
  const queries = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [read, setRead] = useState<HrImportRead | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [result, setResult] = useState<HrImportResult | null>(null);
  const [show, setShow] = useState<"all" | "open">("open");
  const action = useAction();
  const info = sheets.data?.kinds.find((one) => one.key === (kind as HrImportKind));
  if (!sheets.data) return <PageState query={sheets} what="the sheet" />;

  const choose = () =>
    action.run(async () => {
      const picked = file.current?.files?.[0];
      const form = new FormData();
      if (picked) form.append("file", picked);
      const found = await api<HrImportRead>(`/api/hr/import/${kind}/read`, { body: form });
      setRead(found);
      setMapping(found.mapping);
      setResult(null);
    });
  const go = (save: boolean) =>
    action.run(async () => {
      if (!read) return;
      setResult(await api<HrImportResult>(`/api/hr/import/${kind}`, { body: { mapping, rows: read.rows, save } }));
      if (save) await queries.invalidateQueries({ queryKey: ["hr"] });
    });
  const passing = result ? result.counts.new + result.counts.update : 0;
  const listed = result?.rows.filter((one) => show === "all" || one.status !== "same") ?? [];
  const step = !read ? 1 : !result ? 2 : result.saved ? 4 : 3;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <PageHead
        title={`Import: ${info?.title ?? kind}`}
        sub={info?.what}
        actions={
          <>
            <a className={LINK} href={`/api/hr/export/${kind}.xlsx?template=1`} download>
              <Download size={14} /> Blank template
            </a>
            <Link className={LINK} to="/hr/import-export">
              All sheets
            </Link>
          </>
        }
      >
        <ol className="flex flex-wrap gap-2 text-xs font-semibold">
          {["Choose the file", "Match the columns", "Test run", "Saved"].map((label, index) => (
            <li
              key={label}
              className={`rounded-full px-2.5 py-1 ${index + 1 === step ? "bg-brand text-white" : index + 1 < step ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}
            >
              {index + 1}. {label}
            </li>
          ))}
        </ol>
      </PageHead>

      <Panel title="1. Choose the file">
        <div className="flex flex-wrap items-center gap-3 p-4">
          <input ref={file} type="file" accept=".xlsx,.csv" className="text-sm" aria-label="The sheet (.xlsx or .csv)" />
          <Button variant={step === 1 ? "primary" : "plain"} small disabled={action.busy} onClick={choose}>
            <Upload size={14} /> Read it
          </Button>
          <span className="text-xs text-slate-500">Excel (.xlsx) or .csv, up to 10 MB and 2,000 rows. The file isn't kept.</span>
        </div>
      </Panel>

      {read && (
        <Panel title={`2. Match the columns · ${read.rows.length} rows`}>
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {read.columns.map((column) => (
              <label key={column.key} className="flex flex-col gap-1 text-xs">
                <span className="font-semibold text-slate-700">
                  {column.label}
                  {column.note && <span className="ml-1 font-normal text-slate-500">· {column.note}</span>}
                </span>
                <select
                  className="field h-9"
                  value={mapping[column.key] ?? ""}
                  onChange={(event) => {
                    setMapping({ ...mapping, [column.key]: event.target.value === "" ? null : Number(event.target.value) });
                    setResult(null);
                  }}
                >
                  <option value="">— not in the file —</option>
                  {read.headers.map((head, at) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: headings may repeat; their place is the key.
                    <option key={at} value={at}>
                      {head || `Column ${at + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3 border-t border-slate-100 px-4 py-3">
            <Button variant={step === 2 ? "primary" : "plain"} small disabled={action.busy} onClick={() => go(false)}>
              {action.busy && step === 2 ? "Checking…" : "Test run (changes nothing)"}
            </Button>
          </div>
        </Panel>
      )}

      <Problem message={action.problem?.message} />

      {result && (
        <Panel
          title={result.saved ? "Saved" : "3. Test run: what would happen"}
          actions={
            <>
              {(Object.keys(STATUS) as HrImportRow["status"][])
                .filter((key) => result.counts[key])
                .map((key) => (
                  <Pill key={key} tone={STATUS[key][1]}>
                    {result.counts[key]} {STATUS[key][0].toLowerCase()}
                  </Pill>
                ))}
              <Button small onClick={() => setShow(show === "all" ? "open" : "all")}>
                {show === "all" ? "Hide unchanged rows" : "Show every row"}
              </Button>
            </>
          }
        >
          {result.saved ? (
            <p className="px-4 pt-3 text-sm text-emerald-800">
              {passing} row{passing === 1 ? "" : "s"} saved. The rows listed with a problem were left out: put them right in the file and import it again (saved rows will
              say "Nothing to change").
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3 px-4 pt-3 text-sm">
              <span className="text-slate-600">Nothing is saved yet.</span>
              <Button variant="primary" small disabled={action.busy || !passing} onClick={() => go(true)}>
                {action.busy ? "Saving…" : `Save ${passing} row${passing === 1 ? "" : "s"}`}
              </Button>
              {result.counts.problem + result.counts.not_found > 0 && (
                <span className="text-xs text-slate-500">The rows with a problem are left out.</span>
              )}
            </div>
          )}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  <th className="px-4 py-2">Line</th>
                  <th className="px-3 py-2">Who / what</th>
                  <th className="px-3 py-2">Result</th>
                  <th className="px-3 py-2">Changes, or why not</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {listed.map((one) => (
                  <tr key={one.line}>
                    <td className="px-4 py-2 text-xs text-slate-500 tabular-nums">{one.line}</td>
                    <td className="px-3 py-2 font-medium">{one.who || "—"}</td>
                    <td className="px-3 py-2">
                      <Pill tone={STATUS[one.status][1]}>{STATUS[one.status][0]}</Pill>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {one.problem && <div className="text-bad">{one.problem}</div>}
                      {one.changes.map((change) => (
                        <div key={change}>{change}</div>
                      ))}
                    </td>
                  </tr>
                ))}
                {!listed.length && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                      Every row matches what is in the CRM already.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
