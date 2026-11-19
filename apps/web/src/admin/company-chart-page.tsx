// The Admin panel's company chart as the CRM is built: every box of the 2026 chart from the top,
// who heads it, who is under whom, each seat's people, their work, their desk in the CRM and how
// far it is built. Laid beside the paper chart to check it box by box.

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { type ChartBox, type ChartSeat, COMPANY_CHART, type Status } from "./company-chart";
import { CARD, PageHead } from "../ui";

const STATUS: Record<Status, string> = {
  built: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  partly: "bg-amber-50 text-amber-800 ring-amber-200",
  "not yet": "bg-slate-100 text-slate-600 ring-slate-200",
};

function count(box: ChartBox, status: Status): number {
  return box.seats.filter((seat) => seat.status === status).length + (box.boxes ?? []).reduce((sum, child) => sum + count(child, status), 0);
}

function Seat({ seat }: { seat: ChartSeat }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${seat.lead ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-slate-900">
          {seat.title}
          {seat.lead && <span className="ml-1.5 text-[11px] font-medium text-emerald-700">heads the box</span>}
        </span>
        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${STATUS[seat.status]}`}>{seat.status}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {seat.people.map((person) => (
          <span key={person} className={`rounded-md px-1.5 py-0.5 text-[11.5px] ${person.startsWith("Vacant") ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700"}`}>
            {person}
          </span>
        ))}
      </div>
      {seat.work.length > 0 && (
        <ul className="mt-1.5 list-disc pl-4 text-[12px] text-slate-600">
          {seat.work.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <div className="mt-1.5 text-[12px] text-slate-500">
        <b className="font-semibold text-slate-700">In the CRM:</b> {seat.desk ? `desk "${seat.desk}"` : "no desk yet"}
        {seat.screens.length > 0 && ` · ${seat.screens.join(" · ")}`}
      </div>
    </div>
  );
}

function Box({ box, depth }: { box: ChartBox; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const built = count(box, "built");
  const partly = count(box, "partly");
  const notYet = count(box, "not yet");
  return (
    <section className={depth === 0 ? "" : "border-l-2 border-slate-200 pl-3 sm:pl-4"}>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 py-1.5 text-left">
        {open ? <ChevronDown className="size-4 text-slate-400" /> : <ChevronRight className="size-4 text-slate-400" />}
        <span className={`font-bold text-slate-900 ${depth === 0 ? "text-base" : "text-[14px]"}`}>{box.name}</span>
        <span className="text-[11.5px] text-slate-500">
          {built} built · {partly} partly · {notYet} not yet
          {box.checked ? ` · checked against the chart ${box.checked}` : " · not checked box by box yet"}
        </span>
      </button>
      {open && (
        <div className="space-y-2 pb-2">
          {box.note && <p className="text-[12px] text-slate-500 italic">{box.note}</p>}
          {box.seats.length > 0 && (
            <div className="grid gap-2 lg:grid-cols-2">
              {box.seats.map((seat) => (
                <Seat key={seat.title} seat={seat} />
              ))}
            </div>
          )}
          {(box.boxes ?? []).map((child) => (
            <Box key={child.name} box={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </section>
  );
}

export function AdminCompanyChartPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHead
        title="Company chart, as the CRM is built"
        sub="From the 2026 chart, box by box: who heads each box, who is under whom, each seat's work, its desk in the CRM and how far it is built. Filled one business at a time."
      />
      <div className={`${CARD} p-4`}>
        <Box box={COMPANY_CHART} depth={0} />
      </div>
    </div>
  );
}
