// The desktop on the home page's "One screen for the whole company" (Aryan, 27 Nov): a copy of a
// MedRep's Home as it looks in the app (the sidebar, the top bar, My day on the coral photo, My
// KPIs with the gauge and the daily wave, the blue day card, today's pulse), drawn with made-up
// names and figures only: nothing here is read from the database. It is drawn at a desktop's size
// (1280 × 780) and scaled down to fit the monitor, so it looks the same at any width.

import {
  Building2,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  Gauge,
  HandCoins,
  House,
  LogIn,
  MessageCircle,
  Pill,
  PlusCircle,
  RefreshCw,
  Search,
  TrendingUp,
  UserRound,
  ArrowLeftRight,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

const W = 1280;
const H = 780;

/** Made-up sales each day of the month, for the wave (no real figures). */
const DAILY = [0, 0, 3, 5, 0, 0, 4, 7, 2, 0, 0, 6, 9, 3, 0, 0, 5, 8, 4, 0, 0, 7, 10, 6, 0, 0, 0, 0, 0, 0];

const MENU: { icon: typeof House; label: string; on?: boolean; badge?: number; more?: boolean }[] = [
  { icon: House, label: "Home", on: true },
  { icon: ClipboardList, label: "My orders", badge: 2 },
  { icon: Building2, label: "Hospitals", more: true },
  { icon: CalendarCheck, label: "Visits", more: true },
  { icon: Gauge, label: "My numbers", more: true },
];

const PULSE = [
  { icon: TrendingUp, tone: "bg-emerald-500", label: "Sales pace vs target", value: "92%", sub: "₱412,500 of ₱450,000 this month" },
  { icon: HandCoins, tone: "bg-amber-400", label: "Days to collect", value: "41 days", sub: "₱96,200 owed on credit" },
  { icon: RefreshCw, tone: "bg-emerald-500", label: "Not reordered", value: "1", sub: "late or at risk against their gap" },
  { icon: FileText, tone: "bg-emerald-500", label: "Invoice on the last working day", value: "Yes", sub: "3 invoices on Wed, Nov 25" },
];

function Gauge92() {
  const per = 19;
  const lit = Math.round(0.92 * per);
  return (
    <div className="relative w-[104px] shrink-0">
      <svg viewBox="0 0 100 54" className="w-full">
        {[44, 37, 30].map((r) =>
          Array.from({ length: per }, (_, i) => {
            const angle = Math.PI - (i / (per - 1)) * Math.PI;
            return (
              <circle
                key={`${r}-${i}`}
                cx={50 + r * Math.cos(angle)}
                cy={50 - r * Math.sin(angle)}
                r={r === 44 ? 2.1 : 1.8}
                fill={i < lit ? "#1d9fda" : "#e2e8f0"}
              />
            );
          }),
        )}
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <p className="text-[16px] leading-none font-medium text-slate-900">92%</p>
        <p className="mt-0.5 text-[10px] text-slate-500">of target</p>
      </div>
    </div>
  );
}

/** The screen itself, at full size. */
function Screen() {
  const top = Math.max(...DAILY);
  return (
    // app-screen: the public page's reset (margin 0 on everything) is undone inside (HomePage.css).
    <div className="app-screen flex h-full w-full bg-white font-sans text-[13px] leading-normal text-[#1f2733]" style={{ fontFamily: "Poppins, ui-sans-serif, system-ui, sans-serif" }}>
      {/* The sidebar. */}
      <div className="flex w-60 shrink-0 flex-col border-r border-slate-200/80 bg-white px-3 py-4">
        <div className="flex items-center gap-2.5 px-1">
          <img src="/system-logos/web/medreps.webp" alt="" className="size-9 object-contain" />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight text-slate-900">Bishnoi One</div>
            <div className="text-[15px] font-semibold tracking-tight text-slate-900">MedReps</div>
          </div>
        </div>
        <div className="mt-4 px-1">
          <div className="text-[13px] font-semibold text-slate-900">Hospital CHC</div>
          <div className="text-[11px] text-slate-500">2MG Inc.</div>
        </div>
        <div className="mt-3 flex h-10 items-center gap-2 rounded-[10px] bg-[#1d9fda] px-3 text-[13px] font-semibold text-white">
          <PlusCircle className="size-4" /> Create New Order
        </div>
        <div className="mt-4 flex flex-col gap-0.5">
          {MENU.map((one) => (
            <div
              key={one.label}
              className={`flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] ${one.on ? "bg-[#e8f6fc] font-medium text-slate-900" : "text-slate-600"}`}
            >
              <one.icon className={`size-[17px] ${one.on ? "text-[#1784b5]" : "text-slate-400"}`} />
              <span className="flex-1">{one.label}</span>
              {one.badge && (
                <span className="inline-grid h-4 min-w-4 place-items-center rounded-full bg-[#1d9fda] px-[3px] text-[9.5px] leading-none font-semibold text-white">
                  {one.badge}
                </span>
              )}
              {one.more && <ChevronRight className="size-4 text-slate-400" />}
            </div>
          ))}
        </div>
        <div className="mt-4 px-2.5 text-[10px] font-semibold tracking-[0.12em] text-slate-400 uppercase">Look up</div>
        <div className="mt-1 flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-slate-600">
          <Pill className="size-[17px] text-slate-400" /> Medicines &amp; stock
        </div>
        <div className="mx-2.5 my-3 h-px bg-slate-200" />
        <div className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-slate-600">
          <UserRound className="size-[17px] text-slate-400" /> <span className="flex-1">Me</span>
          <ChevronRight className="size-4 text-slate-400" />
        </div>
        <div className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-slate-600">
          <MessageCircle className="size-[17px] text-slate-400" /> <span className="flex-1">Messages</span>
          <span className="inline-grid h-4 min-w-4 place-items-center rounded-full bg-[#1d9fda] px-[3px] text-[9.5px] leading-none font-semibold text-white">
            3
          </span>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* The top bar. */}
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200/80 px-4">
          <div className="ml-auto flex h-10 w-full max-w-xl items-center gap-2 rounded-[10px] bg-slate-100 px-3 text-[13px] text-slate-500">
            <Search className="size-4" /> Search medicines, customers, orders, people
          </div>
          <div className="flex h-10 items-center gap-2 rounded-full border border-slate-200 px-3 text-[13px] text-slate-700">
            <span className="grid size-6 place-items-center rounded-full bg-[#e8f6fc] text-[#1784b5]">
              <ArrowLeftRight className="size-3.5" />
            </span>
            MedReps
          </div>
          <div className="flex h-10 items-center gap-2 rounded-[10px] bg-[#1d9fda] px-3.5 text-[13px] font-semibold text-white">
            <LogIn className="size-4" /> Start working
          </div>
          <div className="flex items-center gap-1">
            <span className="grid size-9 place-items-center rounded-full bg-[#1d9fda] text-[13px] font-semibold text-white">M</span>
            <ChevronDown className="size-4 text-slate-400" />
          </div>
        </div>

        {/* The Home. */}
        <div className="min-h-0 flex-1 space-y-4 overflow-hidden px-8 pt-5">
          <div>
            <div className="text-xs text-slate-500">Friday, 27 November</div>
            <div className="text-[28px] leading-tight font-semibold tracking-tight text-slate-900">Good morning, Maria</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium tracking-wide text-slate-600 uppercase">Hosp</span>
              <span>Makati</span>
              <span className="text-slate-400">· reports to Paolo, Area manager</span>
            </div>
          </div>

          {/* My day, on the coral photo. */}
          <div className="flex flex-col gap-3 rounded-2xl bg-[linear-gradient(90deg,rgba(196,40,40,0.72)_0%,rgba(214,58,58,0.5)_45%,rgba(230,80,80,0.12)_72%,transparent_82%),url('/homeimage.webp')] bg-cover bg-[position:right_center] p-4 pr-[24%]">
            <div className="text-base font-medium text-white">My day</div>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["Start", "now"],
                ["Visits", ""],
                ["Report", ""],
              ].map(([label, state]) => (
                <div key={label} className="flex flex-col items-center gap-1.5">
                  <span className={`text-[12px] ${state ? "text-white" : "text-white/75"}`}>{label}</span>
                  <span className={`size-1.5 rounded-full ${state ? "bg-white" : "bg-white/50"}`} />
                  <span className="h-2 w-full overflow-hidden rounded-full bg-white/30">
                    <span className={`block h-full rounded-full bg-white ${state ? "w-1/2" : "w-0"}`} />
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-white/90">
                <b className="font-medium text-white">Your day hasn't started.</b> 4 visits planned for today.
              </p>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-9 items-center rounded-[9px] px-3.5 text-[13px] font-semibold text-white ring-1 ring-white/70">Open</span>
                <span className="inline-flex h-9 items-center rounded-[9px] bg-white px-3.5 text-[13px] font-semibold text-[#c62828]">
                  Start working
                </span>
              </div>
            </div>
          </div>

          {/* My KPIs. */}
          <div className="flex items-center justify-between">
            <div className="text-base font-semibold text-slate-900">My KPIs</div>
            <div className="inline-flex gap-0.5 rounded-lg bg-slate-100 p-1 text-[13px]">
              {["Today", "Yesterday", "Pick a date", "This month"].map((one, i) => (
                <span
                  key={one}
                  className={`rounded-md px-3.5 py-1.5 ${i === 0 ? "bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.12)]" : "text-slate-500"}`}
                >
                  {one}
                </span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col rounded-[22px] border border-slate-200/80 bg-[linear-gradient(160deg,#ffffff_0%,#f8fafc_55%,#eef4ff_100%)] p-4">
              <div className="text-[15px] font-medium text-slate-900">My Own KPI</div>
              <div className="mt-0.5 text-xs text-slate-500">orders that are yours</div>
              <div className="mt-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[32px] leading-none font-medium tracking-[-0.03em] text-slate-900">₱412,500.00</div>
                  <div className="mt-1 text-xs text-slate-500">invoiced, without VAT · With VAT ₱462,000.00</div>
                  <span className="mt-2 inline-flex rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-700">
                    92% of ₱450,000.00 target
                  </span>
                </div>
                <Gauge92 />
              </div>
              <div className="mt-3 flex h-10 items-end gap-[3px]">
                {DAILY.map((sales, i) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: one bar per day
                    key={i}
                    className={`min-w-0 flex-1 rounded-full ${sales > 0 ? "bg-slate-800" : "bg-slate-300"}`}
                    style={{ height: sales > 0 ? `${Math.max(28, (sales / top) * 100)}%` : "22%" }}
                  />
                ))}
              </div>
              <div className="mt-3 grid grid-cols-4">
                {[
                  ["Orders invoiced", "14", "bg-[#1d9fda] text-white"],
                  ["New customers", "2", "bg-[#f5c400] text-[#3b2f00]"],
                  ["Orders raised", "17", "bg-[#e8505b] text-white"],
                  ["Orders held", "1", "bg-[#22b378] text-white"],
                ].map(([label, value, tone]) => (
                  <div key={label} className={`px-3 py-2.5 ${tone}`}>
                    <div className="text-[18px] leading-tight font-medium">{value}</div>
                    <div className="truncate text-[11px] opacity-85">{label}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col rounded-[22px] bg-[linear-gradient(155deg,#1784b5_0%,#1d9fda_45%,#38bdf8_100%)] p-4 text-white">
              <div className="text-[15px] font-medium">My sales today</div>
              <div className="mt-0.5 text-xs text-white/75">without VAT · so far today</div>
              <div className="mt-3 text-[32px] leading-none font-medium tracking-[-0.03em]">₱38,750.00</div>
              <span className="mt-2 inline-flex w-fit rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-medium ring-1 ring-white/30">
                2 orders invoiced
              </span>
              <div className="mt-auto pt-4">
                <div className="grid grid-cols-12 gap-1">
                  {Array.from({ length: 36 }, (_, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: a fixed grid of dots
                    <span key={i} className={`aspect-square rounded-[3px] ${i < 3 ? "bg-white" : "bg-white/20"}`} />
                  ))}
                </div>
                <p className="mt-2 text-[12px] text-white/85">
                  <span className="text-[17px] font-medium text-white">9%</span> of the month's sales so far
                </p>
              </div>
            </div>
          </div>

          {/* Today's pulse. */}
          <div className="grid grid-cols-4 gap-3">
            {PULSE.map((one) => (
              <div key={one.label} className="flex min-w-0 items-center gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200">
                <span className={`grid size-10 shrink-0 place-items-center rounded-full text-white ${one.tone}`}>
                  <one.icon className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-medium text-slate-900">{one.label}</span>
                  <span className="mt-0.5 block truncate text-xl font-medium tracking-tight text-slate-900">{one.value}</span>
                  <span className="block truncate text-[11px] font-medium text-slate-600">{one.sub}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The screen scaled to the monitor's width. */
export function MedrepScreen() {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.8);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const fit = () => setScale(element.clientWidth / W || 0.8);
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(element);
    return () => watch.disconnect();
  }, []);
  return (
    <div ref={box} className="relative w-full overflow-hidden" style={{ height: H * scale }}>
      <div className="absolute top-0 left-0 origin-top-left" style={{ width: W, height: H, transform: `scale(${scale})` }}>
        <Screen />
      </div>
    </div>
  );
}
