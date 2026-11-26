import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { zMoney } from "../kinds";
import { BirCard, BirGuard, BirHeader, downloadBirAsset, useBirCompany } from "./shared";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type FilingLogRow = {
  id: number;
  formCode: string;
  periodLabel: string;
  periodFrom: string;
  periodTo: string;
  filedOn: string | null;
  referenceNo: string | null;
  amountDueCentavos: number | null;
  status: "draft" | "filed" | "paid" | "amended";
  byPerson: string | null;
};

export function BirReturnsPage() {
  const [company, setCompany] = useBirCompany();
  const [params, setParams] = useSearchParams();
  const queries = useQueryClient();
  const [dlError, setDlError] = useState<string | null>(null);

  const year = Number(params.get("year")) || 2026;
  const q = Number(params.get("q")) || 1;
  const month = Number(params.get("month")) || (q - 1) * 3 + 1;
  const sawtForm = params.get("sawtForm") === "2550Q" ? "2550Q" : "1702Q";
  const rateBp = params.get("rateBp") === "2000" ? 2000 : 2500;
  const tab = (params.get("tab") as "vat" | "ewt" | "income" | "payroll" | "dat" | "log") || "vat";

  const set = (next: Record<string, string | number>) => {
    setDlError(null);
    setParams((now) => {
      const out = new URLSearchParams(now);
      for (const [k, v] of Object.entries(next)) out.set(k, String(v));
      return out;
    });
  };

  const qVat = useQuery({
    queryKey: ["books", "bir", "2550q", company, year, q],
    queryFn: () => api<{ form: string; title: string; period: { label: string }; lines: { key: string; label: string; amountCentavos?: number; rateBp?: number }[]; notes: string[] }>(`/api/books/bir/returns/2550q?company=${company}&year=${year}&q=${q}`),
    enabled: tab === "vat",
  });

  const q1601eq = useQuery({
    queryKey: ["books", "bir", "1601eq", company, year, q],
    queryFn: () => api<{ form: string; period: { label: string }; rows: { atc: string; nature: string; rateBp: number; baseCentavos: number; taxCentavos: number }[]; totalCentavos: number; notes: string[] }>(`/api/books/bir/returns/1601eq?company=${company}&year=${year}&q=${q}`),
    enabled: tab === "ewt",
  });

  const q0619e = useQuery({
    queryKey: ["books", "bir", "0619e", company, year, month],
    queryFn: () => api<{ form: string; period: { label: string }; rows: { atc: string; nature: string; rateBp: number; baseCentavos: number; taxCentavos: number }[]; totalCentavos: number }>(`/api/books/bir/returns/0619e?company=${company}&year=${year}&month=${month}`),
    enabled: tab === "ewt",
  });

  const q1702q = useQuery({
    queryKey: ["books", "bir", "1702q", company, year, q, rateBp],
    queryFn: () => api<{ form: string; period: { label: string }; lines: { key: string; label: string; amountCentavos: number }[]; notes: string[] }>(`/api/books/bir/returns/1702q?company=${company}&year=${year}&q=${Math.min(3, q)}&rateBp=${rateBp}`),
    enabled: tab === "income",
  });

  const q1601c = useQuery({
    queryKey: ["books", "bir", "1601c", company, year, month],
    queryFn: () =>
      api<{
        period: { label: string };
        rows: { personId: number; name: string; tin: string | null; grossCentavos: number; nonTaxableStatCentavos: number; taxableCentavos: number; taxWithheldCentavos: number }[];
        totals: { employees: number; grossCentavos: number; nonTaxableStatCentavos: number; taxableCentavos: number; taxWithheldCentavos: number };
        notes: string[];
      }>(`/api/books/bir/returns/1601c?company=${company}&year=${year}&month=${month}`),
    enabled: tab === "payroll",
  });

  const qSawt = useQuery({
    queryKey: ["books", "bir", "sawt", company, year, q, sawtForm],
    queryFn: () =>
      api<{
        rows: { tin: string | null; payor: string; atc: string; incomePaymentCentavos: number; withheldCentavos: number }[];
        totals: { incomePaymentCentavos: number; withheldCentavos: number };
      }>(`/api/books/bir/lists/sawt?company=${company}&year=${year}&q=${q}&form=${sawtForm}`),
    enabled: tab === "dat",
  });

  const qSli = useQuery({
    queryKey: ["books", "bir", "sli", company, year, q],
    queryFn: () =>
      api<{
        rows: { id: number; date: string; number: string; supplier: string; ieirdNo: string | null; dutiableCentavos: number; vatCentavos: number }[];
        totals: { dutiableCentavos: number; vatCentavos: number; landedTotalCentavos: number };
      }>(`/api/books/bir/lists/sli?company=${company}&year=${year}&q=${q}`),
    enabled: tab === "dat",
  });

  const qLog = useQuery({
    queryKey: ["books", "bir", "filing-log", company],
    queryFn: () => api<{ rows: FilingLogRow[] }>(`/api/books/bir/filing-log?company=${company}`),
    enabled: tab === "log",
  });

  const [logForm, setLogForm] = useState({ formCode: "2550Q", periodLabel: "Q1 2026", periodFrom: "2026-01-01", periodTo: "2026-03-31", referenceNo: "", status: "filed" as "draft" | "filed" | "paid" | "amended" });
  const addLog = useMutation({
    mutationFn: () => api("/api/books/bir/filing-log", { method: "POST", body: { company, ...logForm } }),
    onSuccess: () => void queries.invalidateQueries({ queryKey: ["books", "bir", "filing-log", company] }),
  });

  const triggerDownload = async (url: string, fallback: string) => {
    setDlError(null);
    const err = await downloadBirAsset(url, fallback);
    if (err) setDlError(err);
  };

  const qMonths = [(q - 1) * 3 + 1, (q - 1) * 3 + 2, (q - 1) * 3 + 3];

  return (
    <BirGuard>
      <BirHeader
        title="BIR Returns, Official Draft PDFs & .DAT Files"
        subtitle="Instant-update BIR schedules and official template review drafts, strictly isolated per company."
        company={company}
        onCompanyChange={setCompany}
        right={
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <label className="flex flex-col gap-0.5 text-[11px] text-[#6c718a]">
              Year
              <select value={year} onChange={(e) => set({ year: e.target.value })} className="h-8 rounded border border-[#d7d5e2] bg-white px-2 text-[13px] text-[#212529]">
                {[2025, 2026, 2027].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-[11px] text-[#6c718a]">
              Quarter
              <select value={q} onChange={(e) => set({ q: e.target.value })} className="h-8 rounded border border-[#d7d5e2] bg-white px-2 text-[13px] text-[#212529]">
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>Q{n}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-[11px] text-[#6c718a]">
              Month
              <select value={month} onChange={(e) => set({ month: e.target.value })} className="h-8 rounded border border-[#d7d5e2] bg-white px-2 text-[13px] text-[#212529]">
                {MONTH_NAMES.map((name, idx) => (
                  <option key={name} value={idx + 1}>{name}</option>
                ))}
              </select>
            </label>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5 border-b border-[#ebeaf2] pb-3">
        {(
          [
            ["vat", "VAT (2550Q)"],
            ["ewt", "Withholding (0619-E / 1601-EQ / 1604-E)"],
            ["income", "Income Tax (1702Q)"],
            ["payroll", "Compensation (1601-C)"],
            ["dat", "RELIEF & Alphalist (.DAT / SAWT / SLI)"],
            ["log", "Filing Log"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => set({ tab: key })}
            className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
              tab === key ? "bg-[#408dfb] text-white" : "border border-[#d7d5e2] bg-white text-[#212529] hover:bg-[#f4f6fb]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {dlError && <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{dlError}</div>}

      {tab === "vat" && qVat.data && (
        <BirCard
          title={`${qVat.data.form} — ${qVat.data.period.label}`}
          right={
            qVat.data.form === "2550Q" && (
              <button type="button" onClick={() => void triggerDownload(`/api/books/bir/returns/2550q/pdf?company=${company}&year=${year}&q=${q}`, `2550Q-${year}-Q${q}.pdf`)} className="inline-flex h-8 items-center gap-1.5 rounded border border-[#d7d5e2] bg-white px-3 text-[12px] hover:bg-[#f4f6fb]">
                <FileText size={14} /> Download 2550Q Draft PDF
              </button>
            )
          }
        >
          <table className="w-full text-[13px]">
            <tbody>
              {qVat.data.lines.map((ln) => (
                <tr key={ln.key} className="border-t border-[#f2f1f7] first:border-t-0">
                  <td className="py-2 pr-3 text-[#212529]">{ln.label}</td>
                  <td className="py-2 text-right font-medium tabular-nums">
                    {ln.rateBp != null ? `${(ln.rateBp / 100).toFixed(1)}%` : zMoney(ln.amountCentavos ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 space-y-1 text-[12px] text-[#6c718a]">
            {qVat.data.notes.map((n) => <div key={n}>{n}</div>)}
          </div>
        </BirCard>
      )}

      {tab === "ewt" && (
        <div className="space-y-5">
          <BirCard
            title={`1601-EQ Quarterly EWT — Q${q} ${year}`}
            right={
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void triggerDownload(`/api/books/bir/returns/1601eq/pdf?company=${company}&year=${year}&q=${q}`, `1601EQ-${year}-Q${q}.pdf`)} className="inline-flex h-8 items-center gap-1.5 rounded border border-[#d7d5e2] bg-white px-3 text-[12px] hover:bg-[#f4f6fb]">
                  <FileText size={14} /> Download 1601-EQ PDF
                </button>
                <button type="button" onClick={() => void triggerDownload(`/api/books/bir/returns/1604e/pdf?company=${company}&year=${year}`, `1604E-${year}.pdf`)} className="inline-flex h-8 items-center gap-1.5 rounded border border-[#d7d5e2] bg-white px-3 text-[12px] hover:bg-[#f4f6fb]">
                  <FileText size={14} /> Download 1604-E ({year}) PDF
                </button>
              </div>
            }
          >
            {q1601eq.data && (
              <>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-[#ebeaf2] text-left text-[11px] font-semibold text-[#6c718a] uppercase">
                      <th className="py-2 pr-3">ATC</th>
                      <th className="py-2 pr-3">Nature</th>
                      <th className="py-2 pr-3 text-right">Rate</th>
                      <th className="py-2 pr-3 text-right">Tax Base</th>
                      <th className="py-2 text-right">Tax Withheld</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q1601eq.data.rows.map((r) => (
                      <tr key={`${r.atc}-${r.rateBp}`} className="border-t border-[#f2f1f7]">
                        <td className="py-2 pr-3 font-medium">{r.atc}</td>
                        <td className="py-2 pr-3 text-[#555b70]">{r.nature}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.rateBp / 100}%</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{zMoney(r.baseCentavos)}</td>
                        <td className="py-2 text-right font-medium tabular-nums">{zMoney(r.taxCentavos)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-[#21263c] font-semibold">
                      <td colSpan={4} className="py-2 pr-3">Total Expanded Withholding Tax</td>
                      <td className="py-2 text-right tabular-nums">{zMoney(q1601eq.data.totalCentavos)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-2 text-[12px] text-[#6c718a]">{q1601eq.data.notes[0]}</p>
              </>
            )}
          </BirCard>

          <BirCard
            title={`0619-E Monthly EWT — ${MONTH_NAMES[month - 1]} ${year}`}
            right={
              month % 3 !== 0 ? (
                <button type="button" onClick={() => void triggerDownload(`/api/books/bir/returns/0619e/pdf?company=${company}&year=${year}&month=${month}`, `0619E-${year}-${month}.pdf`)} className="inline-flex h-8 items-center gap-1.5 rounded border border-[#d7d5e2] bg-white px-3 text-[12px] hover:bg-[#f4f6fb]">
                  <FileText size={14} /> Download 0619-E PDF
                </button>
              ) : (
                <span className="text-[12px] text-[#6c718a]">Month 3 of the quarter files under 1601-EQ.</span>
              )
            }
          >
            {q0619e.data && (
              <div className="text-[13px]">
                Calculated EWT for {q0619e.data.period.label}: <span className="font-semibold tabular-nums">{zMoney(q0619e.data.totalCentavos)}</span>
              </div>
            )}
          </BirCard>
        </div>
      )}

      {tab === "income" && (
        <BirCard
          title={`1702Q Corporate Income Tax Draft — Q${Math.min(3, q)} ${year}`}
          right={
            <div className="flex flex-wrap items-center gap-2">
              <select value={rateBp} onChange={(e) => set({ rateBp: e.target.value })} className="h-8 rounded border border-[#d7d5e2] bg-white px-2 text-[12px]" aria-label="CIT rate">
                <option value={2500}>25% RCIT</option>
                <option value={2000}>20% SME RCIT</option>
              </select>
              {q <= 3 && (
                <button type="button" onClick={() => void triggerDownload(`/api/books/bir/returns/1702q/pdf?company=${company}&year=${year}&q=${q}&rateBp=${rateBp}`, `1702Q-${year}-Q${q}.pdf`)} className="inline-flex h-8 items-center gap-1.5 rounded border border-[#408dfb] bg-[#408dfb] px-3 text-[12px] font-medium text-white hover:bg-[#2f7ef0]">
                  <FileText size={14} /> Download 1702Q Official Draft PDF
                </button>
              )}
            </div>
          }
        >
          {q === 4 ? (
            <p className="text-[13px] text-[#6c718a]">BIR Form 1702Q covers Q1–Q3 only; Q4 is filed on Annual 1702-RT.</p>
          ) : (
            q1702q.data && (
              <>
                <table className="w-full text-[13px]">
                  <tbody>
                    {q1702q.data.lines.map((ln) => (
                      <tr key={ln.key} className="border-t border-[#f2f1f7] first:border-t-0">
                        <td className="py-2 pr-3">{ln.label}</td>
                        <td className="py-2 text-right font-medium tabular-nums">{zMoney(ln.amountCentavos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 space-y-1 text-[12px] text-[#6c718a]">
                  {q1702q.data.notes.map((n) => <div key={n}>{n}</div>)}
                </div>
              </>
            )
          )}
        </BirCard>
      )}

      {tab === "payroll" && q1601c.data && (
        <BirCard title={`1601-C Compensation Withholding — ${q1601c.data.period.label}`}>
          <div className="mb-3 text-[12px] text-[#6c718a]">{q1601c.data.notes[0]}</div>
          {q1601c.data.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#ebeaf2] text-left text-[11px] font-semibold text-[#6c718a] uppercase">
                    <th className="py-2 pr-3">Employee</th>
                    <th className="py-2 pr-3">TIN</th>
                    <th className="py-2 pr-3 text-right">Gross</th>
                    <th className="py-2 pr-3 text-right">SSS/PHIC/HDMF</th>
                    <th className="py-2 pr-3 text-right">Taxable</th>
                    <th className="py-2 text-right">Tax Withheld</th>
                  </tr>
                </thead>
                <tbody>
                  {q1601c.data.rows.map((r) => (
                    <tr key={r.personId} className="border-t border-[#f2f1f7]">
                      <td className="py-1.5 pr-3">{r.name}</td>
                      <td className="py-1.5 pr-3 text-[#6c718a]">{r.tin || "—"}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{zMoney(r.grossCentavos)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{zMoney(r.nonTaxableStatCentavos)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{zMoney(r.taxableCentavos)}</td>
                      <td className="py-1.5 text-right font-medium tabular-nums">{zMoney(r.taxWithheldCentavos)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-[#21263c] font-semibold">
                    <td colSpan={2} className="py-2 pr-3">Totals ({q1601c.data.totals.employees} employees)</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{zMoney(q1601c.data.totals.grossCentavos)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{zMoney(q1601c.data.totals.nonTaxableStatCentavos)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{zMoney(q1601c.data.totals.taxableCentavos)}</td>
                    <td className="py-2 text-right tabular-nums">{zMoney(q1601c.data.totals.taxWithheldCentavos)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </BirCard>
      )}

      {tab === "dat" && (
        <div className="space-y-5">
          <BirCard title={`Monthly RELIEF .DAT Exports — Q${q} ${year}`}>
            <p className="mb-3 text-[12px] text-[#6c718a]">
              BIR RELIEF requires monthly SLS and SLP .DAT files for each month of the quarter. Downloads block automatically if any customer/supplier lacks a 9-digit TIN.
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              {qMonths.map((m) => (
                <div key={m} className="rounded-md border border-[#ebeaf2] p-3">
                  <div className="mb-2 text-[13px] font-medium text-[#212529]">{MONTH_NAMES[m - 1]} {year}</div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => void triggerDownload(`/api/books/bir/dat/sls?company=${company}&year=${year}&month=${m}`, `SLS-${year}-${m}.DAT`)} className="inline-flex items-center gap-1 rounded border border-[#d7d5e2] px-2.5 py-1 text-[12px] hover:bg-[#f4f6fb]">
                      <Download size={12} /> SLS .DAT
                    </button>
                    <button type="button" onClick={() => void triggerDownload(`/api/books/bir/dat/slp?company=${company}&year=${year}&month=${m}`, `SLP-${year}-${m}.DAT`)} className="inline-flex items-center gap-1 rounded border border-[#d7d5e2] px-2.5 py-1 text-[12px] hover:bg-[#f4f6fb]">
                      <Download size={12} /> SLP .DAT
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[#ebeaf2] pt-3">
              <button type="button" onClick={() => void triggerDownload(`/api/books/bir/dat/qap?company=${company}&year=${year}&q=${q}`, `QAP-${year}-Q${q}.DAT`)} className="inline-flex h-8 items-center gap-1.5 rounded border border-[#d7d5e2] px-3 text-[12px] font-medium hover:bg-[#f4f6fb]">
                <Download size={13} /> Download QAP (1601-EQ) .DAT
              </button>
              <div className="flex items-center gap-2">
                <select value={sawtForm} onChange={(e) => set({ sawtForm: e.target.value })} className="h-8 rounded border border-[#d7d5e2] px-2 text-[12px]" aria-label="SAWT form">
                  <option value="1702Q">SAWT — 1702Q (Income Tax CWT)</option>
                  <option value="2550Q">SAWT — 2550Q (5% Gov't VAT)</option>
                </select>
                <button type="button" onClick={() => void triggerDownload(`/api/books/bir/dat/sawt?company=${company}&year=${year}&q=${q}&form=${sawtForm}`, `SAWT-${sawtForm}-${year}-Q${q}.DAT`)} className="inline-flex h-8 items-center gap-1.5 rounded border border-[#d7d5e2] px-3 text-[12px] font-medium hover:bg-[#f4f6fb]">
                  <Download size={13} /> Download SAWT ({sawtForm}) .DAT
                </button>
              </div>
            </div>
          </BirCard>

          {qSawt.data && (
            <BirCard title={`SAWT Preview (${sawtForm}) — ${qSawt.data.rows.length} row(s)`}>
              <div className="text-[13px]">
                Total Income Payment: <span className="font-medium tabular-nums">{zMoney(qSawt.data.totals.incomePaymentCentavos)}</span> · Total Withheld:{" "}
                <span className="font-medium tabular-nums">{zMoney(qSawt.data.totals.withheldCentavos)}</span>
              </div>
            </BirCard>
          )}

          {qSli.data && (
            <BirCard title={`SLI — Summary List of Importations (Q${q} ${year})`}>
              {qSli.data.rows.length === 0 ? (
                <p className="text-[13px] text-[#6c718a]">No importation-tagged bills recorded in this quarter.</p>
              ) : (
                <div className="text-[13px]">
                  {qSli.data.rows.length} importation(s) · Dutiable: {zMoney(qSli.data.totals.dutiableCentavos)} · Customs VAT: {zMoney(qSli.data.totals.vatCentavos)}
                </div>
              )}
            </BirCard>
          )}
        </div>
      )}

      {tab === "log" && (
        <BirCard title="BIR Filing & Remittance Acknowledgement Log">
          <div className="mb-4 grid gap-2 sm:grid-cols-6">
            <input value={logForm.formCode} onChange={(e) => setLogForm({ ...logForm, formCode: e.target.value })} placeholder="Form (2550Q)" className="h-8 rounded border border-[#d7d5e2] px-2 text-[12px]" />
            <input value={logForm.periodLabel} onChange={(e) => setLogForm({ ...logForm, periodLabel: e.target.value })} placeholder="Period (Q1 2026)" className="h-8 rounded border border-[#d7d5e2] px-2 text-[12px]" />
            <input type="date" value={logForm.periodFrom} onChange={(e) => setLogForm({ ...logForm, periodFrom: e.target.value })} className="h-8 rounded border border-[#d7d5e2] px-2 text-[12px]" />
            <input type="date" value={logForm.periodTo} onChange={(e) => setLogForm({ ...logForm, periodTo: e.target.value })} className="h-8 rounded border border-[#d7d5e2] px-2 text-[12px]" />
            <input value={logForm.referenceNo} onChange={(e) => setLogForm({ ...logForm, referenceNo: e.target.value })} placeholder="eFPS / eBIRForms Ref #" className="h-8 rounded border border-[#d7d5e2] px-2 text-[12px]" />
            <button type="button" onClick={() => addLog.mutate()} disabled={addLog.isPending} className="h-8 rounded bg-[#408dfb] px-3 text-[12px] font-medium text-white hover:bg-[#2f7ef0]">
              Record Filing
            </button>
          </div>
          {qLog.data && (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#ebeaf2] text-left text-[11px] font-semibold text-[#6c718a] uppercase">
                  <th className="py-2 pr-3">Form</th>
                  <th className="py-2 pr-3">Period</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Reference</th>
                  <th className="py-2">Logged By</th>
                </tr>
              </thead>
              <tbody>
                {qLog.data.rows.map((r) => (
                  <tr key={r.id} className="border-t border-[#f2f1f7]">
                    <td className="py-1.5 pr-3 font-medium">{r.formCode}</td>
                    <td className="py-1.5 pr-3">{r.periodLabel}</td>
                    <td className="py-1.5 pr-3 capitalize">{r.status}</td>
                    <td className="py-1.5 pr-3 text-[#6c718a]">{r.referenceNo || "—"}</td>
                    <td className="py-1.5 text-[#6c718a]">{r.byPerson || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </BirCard>
      )}
    </BirGuard>
  );
}
