import { COMPANIES, COMPANY_CODES, type CompanyCode } from "@2mg/api/companies";
import type { ReactNode } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useMe } from "../../auth";
import { LEDGER_ROLES } from "../kinds";

export function useBirCompany(): [CompanyCode, (next: CompanyCode) => void] {
  const [params, setParams] = useSearchParams();
  const raw = (params.get("company") ?? "2mg").toLowerCase();
  const company: CompanyCode = (COMPANY_CODES as readonly string[]).includes(raw) ? (raw as CompanyCode) : "2mg";
  const setCompany = (next: CompanyCode) => {
    setParams((now) => {
      const out = new URLSearchParams(now);
      out.set("company", next);
      return out;
    });
  };
  return [company, setCompany];
}

export function BirGuard({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isPending) return null;
  if (me.data && !LEDGER_ROLES.includes(me.data.role)) return <Navigate to="/books" replace />;
  return <div className="h-full overflow-y-auto bg-white p-5 sm:p-6">{children}</div>;
}

export function BirHeader({
  title,
  subtitle,
  company,
  onCompanyChange,
  right,
}: {
  title: string;
  subtitle: string;
  company: CompanyCode;
  onCompanyChange: (next: CompanyCode) => void;
  right?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-[#ebeaf2] pb-4">
      <div>
        <div className="text-[11px] font-semibold tracking-wide text-[#6c718a] uppercase">
          BIR Compliance · {COMPANIES[company].name}
        </div>
        <h1 className="mt-0.5 text-[20px] font-medium text-[#212529]">{title}</h1>
        <p className="mt-0.5 text-[13px] text-[#6c718a]">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-[#d7d5e2] bg-[#f9f9fb]" role="group" aria-label="BIR filing company">
          {COMPANY_CODES.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => onCompanyChange(code)}
              className={`px-3 py-1.5 text-[12px] font-medium transition-colors ${
                company === code ? "bg-[#408dfb] text-white" : "text-[#212529] hover:bg-white"
              }`}
            >
              {COMPANIES[code].short}
            </button>
          ))}
        </div>
        {right}
      </div>
    </div>
  );
}

export function BirCard({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#ebeaf2] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 border-b border-[#ebeaf2] bg-[#f9f9fb] px-4 py-2">
        <h2 className="text-[14px] font-medium text-[#212529]">{title}</h2>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Downloads a .DAT or PDF endpoint cleanly and surfaces API validation errors in-page. */
export async function downloadBirAsset(url: string, fallbackName: string): Promise<string | null> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return body?.error?.message ?? `Download failed (${res.status}).`;
  }
  const blob = await res.blob();
  const disp = res.headers.get("content-disposition") ?? "";
  const match = /filename="?([^";]+)"?/i.exec(disp);
  const filename = match?.[1] ?? fallbackName;
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
  return null;
}
