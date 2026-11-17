// Below the portal's first screen (Aryan, 18 Nov): what Bishnoi One is and how it works, as one
// long page: what each workspace holds, a black hole with every part of the company around one
// record, one order from start to finish, the field, the books, how it works, questions, the footer. Only words and a look.

import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { TILE_GLOW, TILE_ICONS } from "./tiles";
import { WORKSPACES } from "../workspaces";

const wrap = "mx-auto w-[min(1140px,calc(100%-32px))]";
const eyebrow = "text-[11px] font-semibold tracking-[0.24em] uppercase";
const h2 = "text-[clamp(30px,4.2vw,52px)] leading-[1.05] font-semibold tracking-[-0.04em]";



const JOURNEY = [
  { who: "MedRep or Online desk", what: "takes the order", more: "with the Rx for a patient's purchase" },
  { who: "Management", what: "approves it", more: "price and customer checked" },
  { who: "Finance", what: "confirms the payment", more: "cash, transfer, cheque or terms" },
  { who: "Inventory", what: "gives the batch", more: "expiry and cost kept" },
  { who: "Dispatch", what: "packs and delivers", more: "to the customer's door" },
  { who: "The books", what: "post themselves", more: "sale, payment and cost" },
];

/** What each workspace holds, from its own menu (src/menus.ts). */
const DETAILS: Record<string, { who: string; points: string[] }> = {
  sales: {
    who: "MedReps, team leads and the head of each channel",
    points: ["Today's visits, the visit plan and the calendar", "New orders and leads, taken on the spot", "Your hospitals, doctors and patients", "Collections and customers to call", "Samples, gifts and your expenses", "Your score, and your team's for leads"],
  },
  management: {
    who: "The people who approve every order",
    points: ["Orders to check: approve, send back or hold", "Orders stuck over two days", "Returns to approve", "New customers to check", "Hospitals, doctors and patients"],
  },
  finance: {
    who: "Payments, invoices and the books",
    points: ["Orders to check for payment", "Invoices, payments received and refunds owed", "What each customer owes", "Banking, expenses and journals", "Profit and loss, balance sheet, cash flow and VAT"],
  },
  inventory: {
    who: "Stock and purchasing",
    points: ["Every medicine, batch and expiry", "Adjustments and transfers between warehouses", "Batch trace for a recall", "Samples handed to reps", "Vendors, purchase orders, receives and bills"],
  },
  dispatch: {
    who: "Packing and delivery",
    points: ["Approved, paid orders to pack", "Shipments and couriers", "Each order followed to the customer"],
  },
  online: {
    who: "Messenger, the websites and patients' cases",
    points: ["One inbox for every message", "Leads and enquiries", "Patients' points", "The channels the company sells on"],
  },
  hr: {
    who: "People, attendance and payroll",
    points: ["Everyone in the company chart", "The attendance report", "Leave to approve", "Payroll and payslips"],
  },
  regulatory: {
    who: "Registrations and quality",
    points: ["The registration pipeline", "Complaints and side-effects, each to a due day", "The company's documents"],
  },
  office: {
    who: "The office team",
    points: ["Your daily work log", "Your leave and forms", "Your payslips and messages"],
  },
  ceo: {
    who: "The whole company in one view",
    points: ["What waits on you to decide", "Sales by channel, branch and person", "Scorecards, targets and speed", "The books and every report"],
  },
  admin: {
    who: "Setup, logins and the audit",
    points: ["People, seats and logins", "Company settings", "The audit: who did what, and when", "Data checks"],
  },
};

const FIELD = [
  "Today's visits, the plan and the calendar",
  "An order taken at the counter, with the patient's Rx",
  "What each hospital owes, before you walk in",
  "Samples and gifts handed out, counted",
  "Your score, always up to date",
];

/** Same numbers every time, so the stars don't jump between visits. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = seeded(1811);
const STARS = Array.from({ length: 170 }, (_, i) => ({
  x: random() * 1440,
  y: 120 + random() * 660,
  r: 0.5 + random() * 1.1,
  delay: random() * 5,
  dur: 2.2 + random() * 3.5,
  twinkle: i % 3 !== 0,
  sparkle: i % 23 === 0,
}));

/** Small stars all over the sky, most of them twinkling, a few four-pointed. */
function Stars() {
  return (
    <svg aria-hidden="true" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full">
      {STARS.map((star, i) =>
        star.sparkle ? (
          <path
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
            key={i}
            className="orbit-twinkle"
            style={{ animationDelay: `${star.delay}s`, animationDuration: `${star.dur + 1}s` }}
            d={`M${star.x} ${star.y - 7}l2 5 5 2-5 2-2 5-2-5-5-2 5-2z`}
            fill="#ffe2c2"
          />
        ) : (
          <circle
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
            key={i}
            cx={star.x}
            cy={star.y}
            r={star.r}
            fill="#fff"
            opacity={star.twinkle ? undefined : 0.55}
            className={star.twinkle ? "star-twinkle" : undefined}
            style={star.twinkle ? { animationDelay: `${star.delay}s`, animationDuration: `${star.dur}s` } : undefined}
          />
        ),
      )}
    </svg>
  );
}

/** The first screen's orange and green lines, waving slowly behind a light section. */
function Lines({ flip }: { flip?: boolean }) {
  const wave = (a: string, b: string, dur: number, tone: string, width: string, opacity: string) => (
    <path d={a} stroke={tone} strokeOpacity={opacity} strokeWidth={width} fill="none">
      <animate attributeName="d" values={`${a};${b};${a}`} keyTimes="0;0.5;1" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1" dur={`${dur}s`} repeatCount="indefinite" />
    </path>
  );
  return (
    <svg aria-hidden="true" viewBox="0 0 1440 900" preserveAspectRatio="none" className={`pointer-events-none absolute inset-0 -z-10 h-full w-full ${flip ? "-scale-x-100" : ""}`}>
      {wave("M-80 240C260 150 520 330 820 250S1240 90 1540 190", "M-80 228C260 190 520 290 820 262S1240 135 1540 178", 10, "#1f9d55", "1.6", ".3")}
      {wave("M-80 690C220 560 520 800 860 690S1300 450 1540 540", "M-80 678C220 605 520 755 860 702S1300 495 1540 528", 9, "#f36b21", "1.6", ".32")}
      <path className="orbit-twinkle" d="M1320 140l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#1f9d55" fillOpacity=".5" />
      <path className="orbit-twinkle" style={{ animationDelay: "1.4s" }} d="M120 600l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#f36b21" fillOpacity=".5" />
    </svg>
  );
}

/** Between two sections: a thin wave in the portal's orange and green, with a star, and room around it. */
const Rule = () => (
  <div aria-hidden="true" className="mx-auto w-[min(1140px,calc(100%-32px))] py-10">
    <svg viewBox="0 0 1140 24" preserveAspectRatio="none" className="h-6 w-full">
      <defs>
        <linearGradient id="rule-line" x1="0" x2="1">
          <stop offset="0" stopColor="#f36b21" stopOpacity="0" />
          <stop offset=".3" stopColor="#f36b21" stopOpacity=".45" />
          <stop offset=".7" stopColor="#1f9d55" stopOpacity=".45" />
          <stop offset="1" stopColor="#1f9d55" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 12C180 4 340 20 520 12S860 4 1140 12" stroke="url(#rule-line)" strokeWidth="1.4" fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  </div>
);

const CLOSE = [
  { title: "Pick your workspace", text: "Each department has its own door: sales and field, management, finance, stock, dispatch, people." },
  { title: "Sign in as yourself", text: "Your own login ID and password. Your role decides what you see and what you can do." },
  { title: "Every change kept", text: "Who did it and when, in the audit. Nothing with history is ever deleted." },
];


function Seats() {
  const [open, setOpen] = useState(WORKSPACES[0]?.key ?? "sales");
  const chosen = WORKSPACES.find((one) => one.key === open) ?? WORKSPACES[0];
  const Detail = ({ inline }: { inline?: boolean }) => {
    if (!chosen) return null;
    const detail = DETAILS[chosen.key];
    const Icon = TILE_ICONS[chosen.key];
    return (
      <div className={`relative overflow-hidden rounded-[2rem] border border-white bg-white/85 shadow-[0_30px_60px_-34px_rgba(20,30,50,0.45)] backdrop-blur-xl ${inline ? "mt-2 p-6" : "p-9"}`}>
        <span aria-hidden="true" className="absolute -top-24 -right-24 size-72 rounded-full opacity-20 blur-3xl" style={{ background: TILE_GLOW[chosen.key] }} />
        <div className="relative flex items-center gap-4">
          {!inline && (
            <span className="relative grid size-16 shrink-0 place-items-center rounded-[1.25rem] border border-white bg-white shadow-[0_14px_30px_-16px_rgba(20,30,50,0.35)]">
              <span className="size-9">{Icon && <Icon />}</span>
            </span>
          )}
          <div>
            {!inline && <h3 className="text-2xl font-semibold tracking-[-0.03em]">{chosen.label}</h3>}
            <p className="text-[15px] text-[#5b6472]">{detail?.who}</p>
          </div>
        </div>
        <p className={`relative ${inline ? "mt-4" : "mt-7"} text-[11px] font-semibold tracking-[0.2em] text-[#8a93a3] uppercase`}>What you do here</p>
        <ul className="relative mt-3 grid gap-2.5">
          {detail?.points.map((point) => (
            <li key={point} className="flex items-start gap-3 text-[15px] text-[#2b3340]">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-white" style={{ background: TILE_GLOW[chosen.key] }}>
                <Check className="size-3" strokeWidth={3} aria-hidden="true" />
              </span>
              {point}
            </li>
          ))}
        </ul>
        <p className="relative mt-7 border-t border-black/5 pt-4 text-[13px] text-[#8a93a3]">
          Everyone also has their own leave, forms, payslips and messages.
        </p>
      </div>
    );
  };
  return (
    <section className="relative isolate">
      <Lines />
      <div className={`${wrap} py-24`}>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className={`${eyebrow} text-[#c2410c]`}>Built for every seat</p>
            <h2 className={`${h2} mt-4 max-w-2xl`}>{WORKSPACES.length} workspaces, one company.</h2>
          </div>
        </div>
        <div className="mt-12 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <ul className="grid gap-2 sm:grid-cols-2">
            {WORKSPACES.map((one) => {
              const Icon = TILE_ICONS[one.key];
              const on = one.key === open;
              return (
                <li key={one.key} className={on ? "sm:col-span-2 lg:col-span-1" : undefined}>
                  <button
                    type="button"
                    onClick={() => setOpen(one.key)}
                    aria-expanded={on}
                    className={`group flex w-full items-center gap-3 rounded-[1.25rem] border p-3 text-left transition ${on ? "border-white bg-white shadow-[0_18px_36px_-24px_rgba(20,30,50,0.45)]" : "border-transparent hover:border-white hover:bg-white/70"}`}
                  >
                    <span className="relative grid size-11 shrink-0 place-items-center rounded-xl bg-[#f6f7fb]">
                      <span aria-hidden="true" className={`absolute inset-1.5 rounded-lg blur-md transition-opacity ${on ? "opacity-40" : "opacity-15"}`} style={{ background: TILE_GLOW[one.key] }} />
                      <span className="relative size-6">{Icon && <Icon />}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[15px] ${on ? "font-semibold" : "font-medium"}`}>{one.label}</span>
                      <span className="block truncate text-[13px] text-[#7a8394]">{one.about}</span>
                    </span>
                    <span aria-hidden="true" className={`h-6 w-1 rounded-full transition ${on ? "bg-[#f36b21]" : "bg-transparent"}`} />
                  </button>
                  {on && (
                    <div className="lg:hidden">
                      <Detail inline />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="sticky top-6 hidden lg:block">
            <Detail />
          </div>
        </div>
      </div>
    </section>
  );
}

export function About() {
  return (
    <div id="about" className="relative">
      <Rule />
      <Seats />

      <Rule />

      {/* The black hole: everything turns around one record. */}
      <section className="relative isolate overflow-hidden bg-[linear-gradient(to_bottom,rgba(8,7,12,0)_0,rgba(8,7,12,0.55)_70px,#08070c_160px,#08070c_calc(100%-160px),rgba(8,7,12,0.55)_calc(100%-70px),rgba(8,7,12,0)_100%)] text-white">
        <div className="relative h-[clamp(640px,96vh,920px)]">
          {/* The sun: its light over the whole sky, the stars twinkling around it. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-[160px] bottom-[160px] bg-[radial-gradient(ellipse_75%_80%_at_50%_58%,rgba(255,150,70,0.30),rgba(243,107,33,0.12)_40%,rgba(120,60,140,0.08)_65%,transparent_85%)]" />
          <Stars />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <div className="sun-breathe absolute top-[60%] left-1/2 size-[64rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,160,80,0.32),rgba(243,107,33,0.1)_50%,transparent)]" />
            <div
              className="absolute top-[60%] left-1/2 size-[32rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[repeating-conic-gradient(rgba(255,214,160,0.14)_0deg_1.5deg,transparent_1.5deg_9deg)] [mask-image:radial-gradient(closest-side,black_25%,transparent_100%)]"
              style={{ animation: "spin 160s linear infinite" }}
            />
            <div className="absolute top-[60%] left-1/2 size-[16rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,220,160,0.85),rgba(255,150,60,0.3)_55%,transparent)]" />
            <div className="absolute top-[60%] left-1/2 size-28 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_40%_38%,#fffef8_0%,#fff1c9_30%,#ffc06b_68%,#f36b21_100%)] shadow-[0_0_40px_12px_rgba(255,206,140,0.75),0_0_140px_50px_rgba(255,140,60,0.35)]" />
          </div>
          <div className={`relative ${wrap} pt-44 text-center`}>
            <p className="text-[11px] font-medium tracking-[0.42em] text-white/50 uppercase">What is inside</p>
            <h2 className="mx-auto mt-6 max-w-3xl text-[clamp(34px,5vw,64px)] leading-[1.02] font-medium tracking-[-0.045em] text-white [text-shadow:0_2px_30px_rgba(0,0,0,0.6)]">
              Every part of the company,
              <br />
              around <span className="font-[Iowan_Old_Style,Palatino,Georgia,serif] font-normal tracking-[-0.02em] text-[#ffd9b3] italic">one record.</span>
            </h2>
          </div>
          <p className={`absolute inset-x-0 bottom-44 mx-auto max-w-lg px-4 text-center text-[15px] leading-relaxed text-white/60 [text-shadow:0_2px_20px_rgba(0,0,0,0.8)]`}>
            An order is entered once. Approval, payment, stock, delivery and the books all read and write the same record, so
            nobody types it twice and nobody works from an old copy.
          </p>
        </div>
      </section>

      {/* One order, start to finish. */}
      <div className="relative isolate">
      <Lines flip />
      <section className={`${wrap} py-24`}>
        <p className={`${eyebrow} text-[#1f9d55]`}>One order, start to finish</p>
        <h2 className={`${h2} mt-4 max-w-3xl`}>
          Six hands, <span className="text-[#1f9d55]">one record</span>, no retyping.
        </h2>
        <ol className="mt-14 grid gap-6 md:grid-cols-3 lg:grid-cols-6">
          {JOURNEY.map((step, i) => (
            <li key={step.who} className="relative">
              <div className="flex items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-[#1f9d55]/30 bg-white text-sm font-bold text-[#1f9d55] shadow-sm">{i + 1}</span>
                {i < JOURNEY.length - 1 && <span aria-hidden="true" className="hidden h-px flex-1 bg-gradient-to-r from-[#1f9d55]/40 to-[#f36b21]/30 lg:block" />}
              </div>
              <p className="mt-4 text-[12px] font-semibold tracking-wide text-[#8a93a3] uppercase">{step.who}</p>
              <p className="mt-1 text-lg leading-snug font-semibold tracking-[-0.02em]">{step.what}</p>
              <p className="mt-1 text-sm text-[#5b6472]">{step.more}</p>
            </li>
          ))}
        </ol>
      </section>

      <Rule />

      {/* In the field. */}
      <section className={`${wrap} grid items-center gap-14 py-24 lg:grid-cols-2`}>
        <div>
          <p className={`${eyebrow} text-[#1f9d55]`}>In the field</p>
          <h2 className={`${h2} mt-4`}>The office in a MedRep's pocket.</h2>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-[#5b6472]">
            Made for the phone first. Everything a rep needs between two visits, without calling the office.
          </p>
        </div>
          <ul className="grid gap-4 lg:pl-12">
            {FIELD.map((point) => (
              <li key={point} className="flex items-start gap-3 text-[15px] text-[#2b3340]">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[#1f9d55] text-white">
                  <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                </span>
                {point}
              </li>
            ))}
          </ul>
      </section>

      <Rule />

      {/* The close: how it works, in three lines, and the way in. */}
      <section className="relative">
        <div className={`relative ${wrap} py-28 text-center`}>
          <p className={`${eyebrow} text-[#c2410c]`}>How it works</p>
          <h2 className={`${h2} mx-auto mt-4 max-w-3xl`}>
            One portal. <span className="text-[#f36b21]">Your own login.</span> The same records.
          </h2>
          <ol className="mx-auto mt-16 grid max-w-4xl text-left md:grid-cols-3 md:divide-x md:divide-[#1f2733]/10">
            {CLOSE.map((one, i) => (
              <li key={one.title} className="px-2 py-5 md:px-8 md:py-0">
                <span className="text-sm font-semibold text-[#f36b21] tabular-nums">0{i + 1}</span>
                <h3 className="mt-2 text-xl font-semibold tracking-[-0.02em]">{one.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[#5b6472]">{one.text}</p>
              </li>
            ))}
          </ol>
          <div className="mt-16 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="inline-flex items-center gap-2 rounded-full bg-[#1f2733] px-7 py-3.5 text-sm font-semibold text-white shadow-[0_16px_34px_-14px_rgba(20,30,50,0.6)] transition hover:bg-black"
            >
              Choose your workspace <ArrowRight className="size-4" aria-hidden="true" />
            </button>
            <Link to="/login?with=password" className="inline-flex items-center gap-2 rounded-full border border-[#1f2733]/15 bg-white/70 px-7 py-3.5 text-sm font-semibold text-[#1f2733] transition hover:bg-white">
              Log in with ID and password
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-black/5">
        <div className={`${wrap} flex flex-wrap items-center justify-between gap-3 py-8 text-sm text-[#8a93a3]`}>
          <span className="flex items-center gap-2.5">
            <img src="/brand/bishnoi-one-mark.png" alt="" className="size-7" />
            <span className="font-semibold text-[#1f2733]">Bishnoi One</span>
          </span>
          <span>Each person signs in as themselves · Need access? Ask your administrator</span>
        </div>
      </footer>
      </div>
    </div>
  );
}
