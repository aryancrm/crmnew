import { OWN, type CompanyCode } from "@2mg/api/companies";
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useMe } from "../../auth";
import { useOwnCompanyName } from "../../companies";
import { LEDGER_ROLES } from "../kinds";

/** One company per database since the separation: every row in this database carries OWN ('2mg'). */
export function useBirCompany(): [CompanyCode, (next: CompanyCode) => void] {
  return [OWN, () => {}];
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
  right,
}: {
  title: string;
  subtitle: string;
  company?: CompanyCode;
  onCompanyChange?: (next: CompanyCode) => void;
  right?: ReactNode;
}) {
  const ownName = useOwnCompanyName();
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-[#ebeaf2] pb-4">
      <div>
        <div className="text-[11px] font-semibold tracking-wide text-[#6c718a] uppercase">
          BIR Compliance · {ownName}
        </div>
        <h1 className="mt-0.5 text-[20px] font-medium text-[#212529]">{title}</h1>
        <p className="mt-0.5 text-[13px] text-[#6c718a]">{subtitle}</p>
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
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
